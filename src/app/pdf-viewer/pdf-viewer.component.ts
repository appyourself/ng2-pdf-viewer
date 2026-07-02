/**
 * Created by vadimdez on 21/06/16.
 */
import {
  AfterViewChecked,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  input,
  model,
  output,
  signal,
  untracked, inject
} from '@angular/core';
import { from, fromEvent, Subject } from 'rxjs';
import { debounceTime, filter, take, takeUntil } from 'rxjs';
import * as PDFJS from 'pdfjs-dist';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import * as PDFJSViewer from 'pdfjs-dist/web/pdf_viewer.mjs';

import { createEventBus } from '../utils/event-bus-utils';
import { isSSR } from '../utils/helpers';

import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PDFProgressData,
  PDFSource,
  PDFViewerOptions,
  ZoomScale
} from './typings';



// @ts-expect-error This does not exist outside of polyfill which this is doing
if (typeof Promise.withResolvers === 'undefined' && window) {
  // @ts-expect-error This does not exist outside of polyfill which this is doing
  window.Promise.withResolvers = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// @ts-expect-error This does not exist outside of polyfill which this is doing
if (typeof Promise.try === 'undefined' && window) {
  // @ts-expect-error This does not exist outside of polyfill which this is doing
  window.Promise.try = (fn, ...args) => {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}


export enum RenderTextMode {
  DISABLED,
  ENABLED,
  ENHANCED
}

const DEFAULT_CMAPS_URL =
  typeof PDFJS !== 'undefined'
    ? `https://unpkg.com/pdfjs-dist@${(PDFJS as any).version}/cmaps/`
    : null;

@Component({
  selector: 'pdf-viewer',
  standalone: true,
  imports: [],
  template: `
    <div #pdfViewerContainer class="ng2-pdf-viewer-container">
      <div class="pdfViewer"></div>
    </div>
  `,
  styleUrls: ['./pdf-viewer.component.scss']
})
export class PdfViewerComponent
  implements OnInit, OnDestroy, AfterViewChecked {
  static CSS_UNITS = 96.0 / 72.0;
  static BORDER_WIDTH = 9;

  @ViewChild('pdfViewerContainer') pdfViewerContainer!: ElementRef<HTMLDivElement>;

  public eventBus!: PDFJSViewer.EventBus;
  public pdfLinkService!: PDFJSViewer.PDFLinkService;
  public pdfFindController!: PDFJSViewer.PDFFindController;
  public pdfViewer!: PDFJSViewer.PDFViewer | PDFJSViewer.PDFSinglePageViewer;

  // Outputs
  readonly afterLoadComplete = output<PDFDocumentProxy>();
  readonly pageRendered = output<CustomEvent>();
  readonly pageInitialized = output<CustomEvent>();
  readonly textLayerRendered = output<CustomEvent>();
  readonly onError = output<any>();
  readonly onProgress = output<PDFProgressData>();

  // Inputs
  readonly src = input<string | Uint8Array | PDFSource>();
  readonly cMapsUrl = input<string | null>(DEFAULT_CMAPS_URL);
  readonly renderText = input(true);
  readonly renderTextMode = input<RenderTextMode>(RenderTextMode.ENABLED);
  readonly stickToPage = input(false);
  readonly originalSize = input(true);
  readonly showAll = input(true);
  readonly fitToPage = input(false);
  readonly externalLinkTarget = input('blank');
  readonly showBorders = input(false);
  readonly autoresize = input(true);
  readonly zoomScale = input<ZoomScale>('page-width');

  // Validated inputs (with internal writable signals)
  readonly zoomInput = input(1, { alias: 'zoom' });
  private _zoom = signal(1);

  readonly rotationInput = input(0, { alias: 'rotation' });
  private _rotation = signal(0);

  // Two-way binding model
  readonly page = model(1);

  private isVisible = false;
  private _imageResourcesPath =
    typeof PDFJS !== 'undefined'
      ? `https://unpkg.com/pdfjs-dist@${(PDFJS as any).version}/web/images/`
      : undefined;
  private _pdf: PDFDocumentProxy | undefined;
  private lastLoaded!: string | Uint8Array | PDFSource | null;
  private _latestScrolledPage!: number;
  private pageScrollTimeout: number | null = null;
  private isInitialized = false;
  private loadingTask?: PDFDocumentLoadingTask | null;
  private destroy$ = new Subject<void>();

  private readonly element: ElementRef<HTMLElement> = inject(ElementRef<HTMLElement>);
  private readonly ngZone: NgZone = inject(NgZone);

  // Effects for validated inputs
  private zoomEffect = effect(() => {
    const v = this.zoomInput();
    if (v > 0) this._zoom.set(v);
  });

  private rotationEffect = effect(() => {
    const v = this.rotationInput();
    if (typeof v === 'number' && v % 90 === 0) {
      this._rotation.set(v);
    } else {
      console.warn('Invalid pages rotation angle.');
    }
  });

  // Effects replacing ngOnChanges
  private srcEffect = effect(() => {
    this.src();
    untracked(() => {
      if (isSSR() || !this.isVisible) return;
      this.loadPDF();
    });
  });

  private viewerSetupEffect = effect(() => {
    this.renderText();
    this.showAll();
    untracked(() => {
      if (isSSR() || !this.isVisible || !this._pdf) return;
      this.setupViewer();
      this.resetPdfDocument();
      this.update();
    });
  });

  private pageScrollEffect = effect(() => {
    const page = this.page();
    untracked(() => {
      if (isSSR() || !this.isVisible || !this._pdf) return;
      if (page === this._latestScrolledPage) return;
      this.pdfViewer.scrollPageIntoView({ pageNumber: page });
      this.update();
    });
  });

  private renderEffect = effect(() => {
    this._zoom();
    this.zoomScale();
    this._rotation();
    this.originalSize();
    this.fitToPage();
    this.stickToPage();
    this.externalLinkTarget();
    this.showBorders();
    untracked(() => {
      if (isSSR() || !this.isVisible || !this._pdf) return;
      this.update();
    });
  });

  constructor() {
    if (isSSR()) {
      return;
    }

    let pdfWorkerSrc: string;

    const pdfJsVersion: string = (PDFJS as any).version;
    const versionSpecificPdfWorkerUrl: string = (window as any)[`pdfWorkerSrc${pdfJsVersion}`];

    if (versionSpecificPdfWorkerUrl) {
      pdfWorkerSrc = versionSpecificPdfWorkerUrl;
    } else if (
      window.hasOwnProperty('pdfWorkerSrc') &&
      typeof (window as any).pdfWorkerSrc === 'string' &&
      (window as any).pdfWorkerSrc
    ) {
      pdfWorkerSrc = (window as any).pdfWorkerSrc;
    } else {
      pdfWorkerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfJsVersion
      }/build/pdf.worker.min.mjs`;
    }

    GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  }

  static getLinkTarget(type: string) {
    switch (type) {
      case 'blank':
        return (PDFJSViewer as any).LinkTarget.BLANK;
      case 'none':
        return (PDFJSViewer as any).LinkTarget.NONE;
      case 'self':
        return (PDFJSViewer as any).LinkTarget.SELF;
      case 'parent':
        return (PDFJSViewer as any).LinkTarget.PARENT;
      case 'top':
        return (PDFJSViewer as any).LinkTarget.TOP;
    }

    return null;
  }

  ngAfterViewChecked(): void {
    if (this.isInitialized) {
      return;
    }

    const offset = this.pdfViewerContainer.nativeElement.offsetParent;

    if (this.isVisible === true && offset == null) {
      this.isVisible = false;
      return;
    }

    if (this.isVisible === false && offset != null) {
      this.isVisible = true;

      setTimeout(() => {
        this.initialize();
        this.loadPDF();
      });
    }
  }

  ngOnInit() {
    this.initialize();
    this.setupResizeListener();
  }

  ngOnDestroy() {
    this.clear();
    this.destroy$.next();
    this.loadingTask = null;
  }

  public updateSize() {
    from(
      this._pdf!.getPage(
        this.pdfViewer.currentPageNumber
      )
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (page: PDFPageProxy) => {
          const rotation = this._rotation() + page.rotate;
          const viewportWidth =
            page.getViewport({
              scale: this._zoom(),
              rotation
            }).width * PdfViewerComponent.CSS_UNITS;
          let scale = this._zoom();
          let stickToPage = true;

          // Scale the document when it shouldn't be in original size or doesn't fit into the viewport
          if (
            !this.originalSize() ||
            (this.fitToPage() &&
              viewportWidth > this.pdfViewerContainer.nativeElement.clientWidth)
          ) {
            const viewPort = page.getViewport({ scale: 1, rotation });
            scale = this.getScale(viewPort.width, viewPort.height);
            stickToPage = !this.stickToPage();
          }

          this.pdfViewer.currentScale = scale;
          if (stickToPage) {
            this.pdfViewer.scrollPageIntoView({ pageNumber: page.pageNumber, ignoreDestinationZoom: true });
          }
        }
      });
  }

  public clear() {
    if (this.loadingTask && !this.loadingTask.destroyed) {
      this.loadingTask.destroy();
    }

    if (this._pdf) {
      this._latestScrolledPage = 0;
      this._pdf.cleanup();
      this._pdf = undefined;
    }

    this.pdfViewer && this.pdfViewer.setDocument(null as any);
    this.pdfLinkService && this.pdfLinkService.setDocument(null, null);
    this.pdfFindController && this.pdfFindController.setDocument(null as any);
  }

  private getPDFLinkServiceConfig() {
    const linkTarget = PdfViewerComponent.getLinkTarget(this.externalLinkTarget());

    if (linkTarget) {
      return { externalLinkTarget: linkTarget };
    }

    return {};
  }

  private initEventBus() {
    this.eventBus = createEventBus(PDFJSViewer, this.destroy$);

    fromEvent<CustomEvent>(this.eventBus, 'pagerendered')
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        this.pageRendered.emit(event);
      });

    fromEvent<CustomEvent>(this.eventBus, 'pagesinit')
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        this.pageInitialized.emit(event);
      });

    fromEvent(this.eventBus, 'pagechanging')
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ pageNumber }: any) => {
        if (this.pageScrollTimeout) {
          clearTimeout(this.pageScrollTimeout);
        }

        this.pageScrollTimeout = window.setTimeout(() => {
          this._latestScrolledPage = pageNumber;
          this.page.set(pageNumber);
        }, 100);
      });

    fromEvent<CustomEvent>(this.eventBus, 'textlayerrendered')
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        this.textLayerRendered.emit(event);
      });
  }

  private initPDFServices() {
    this.pdfLinkService = new PDFJSViewer.PDFLinkService({
      eventBus: this.eventBus,
      ...this.getPDFLinkServiceConfig()
    });
    this.pdfFindController = new PDFJSViewer.PDFFindController({
      eventBus: this.eventBus,
      linkService: this.pdfLinkService
    });
  }

  private getPDFOptions(): PDFViewerOptions {
    return {
      eventBus: this.eventBus,
      container: this.element.nativeElement.querySelector('div')!,
      removePageBorders: !this.showBorders(),
      linkService: this.pdfLinkService,
      textLayerMode: this.renderText()
        ? this.renderTextMode()
        : RenderTextMode.DISABLED,
      findController: this.pdfFindController,
      l10n: new PDFJSViewer.GenericL10n('en'),
      imageResourcesPath: this._imageResourcesPath,
      annotationEditorMode: PDFJS.AnnotationEditorType.DISABLE
    };
  }

  private setupViewer() {
    if (this.pdfViewer) {
      this.pdfViewer.setDocument(null as any);
    }

    this.initPDFServices();

    if (this.showAll()) {
      this.pdfViewer = new PDFJSViewer.PDFViewer(this.getPDFOptions());
    } else {
      this.pdfViewer = new PDFJSViewer.PDFSinglePageViewer(this.getPDFOptions());
    }
    this.pdfLinkService.setViewer(this.pdfViewer);

    this.pdfViewer._currentPageNumber = this.page();
  }

  private getValidPageNumber(page: number): number {
    if (page < 1) {
      return 1;
    }

    if (page > this._pdf!.numPages) {
      return this._pdf!.numPages;
    }

    return page;
  }

  private getDocumentParams() {
    const srcValue = this.src();
    const srcType = typeof srcValue;

    if (!this.cMapsUrl()) {
      return srcValue;
    }

    const params: any = {
      cMapUrl: this.cMapsUrl(),
      cMapPacked: true,
      enableXfa: true
    };

    if (srcType === 'string') {
      params.url = srcValue;
    } else if (srcType === 'object') {
      if ((srcValue as any).byteLength !== undefined) {
        params.data = srcValue;
      } else {
        Object.assign(params, srcValue);
      }
    }

    return params;
  }

  private loadPDF() {
    const srcValue = this.src();

    if (!srcValue) {
      return;
    }

    if (this.lastLoaded === srcValue) {
      this.update();
      return;
    }

    this.clear();

    this.setupViewer();

    this.loadingTask = getDocument(this.getDocumentParams());

    this.loadingTask!.onProgress = (progressData: PDFProgressData) => {
      this.onProgress.emit(progressData);
    };

    from(this.loadingTask!.promise as Promise<PDFDocumentProxy>)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (pdf) => {
          this._pdf = pdf;
          this.lastLoaded = srcValue;

          this.afterLoadComplete.emit(pdf);
          this.resetPdfDocument();

          this.update();
        },
        error: (error) => {
          this.lastLoaded = null;
          this.onError.emit(error);
        }
      });
  }

  private update() {
    const validPage = this.getValidPageNumber(this.page());
    if (validPage !== this.page()) {
      this.page.set(validPage);
    }

    this.render();
  }

  private render() {
    const currentPage = this.getValidPageNumber(this.page());

    if (
      this._rotation() !== 0 ||
      this.pdfViewer.pagesRotation !== this._rotation()
    ) {
      // wait until at least the first page is available.
      this.pdfViewer.firstPagePromise?.then(
        () => (this.pdfViewer.pagesRotation = this._rotation())
      );
    }

    if (this.stickToPage()) {
      setTimeout(() => {
        this.pdfViewer.currentPageNumber = currentPage;
      });
    }

    if (!this.pdfViewer._pages?.length) {
      // the first time we wait until pages init
      fromEvent(this.eventBus, 'pagesinit')
        .pipe(take(1), takeUntil(this.destroy$))
        .subscribe(() => {
          this.updateSize();
        });
    } else {
      this.updateSize();
    }
  }

  private getScale(viewportWidth: number, viewportHeight: number) {
    const borderSize = this.showBorders() ? 2 * PdfViewerComponent.BORDER_WIDTH : 0;
    const pdfContainerWidth = this.pdfViewerContainer.nativeElement.clientWidth - borderSize;
    const pdfContainerHeight = this.pdfViewerContainer.nativeElement.clientHeight - borderSize;

    if (
      pdfContainerHeight === 0 ||
      viewportHeight === 0 ||
      pdfContainerWidth === 0 ||
      viewportWidth === 0
    ) {
      return 1;
    }

    let ratio = 1;
    switch (this.zoomScale()) {
      case 'page-fit':
        ratio = Math.min(
          pdfContainerHeight / viewportHeight,
          pdfContainerWidth / viewportWidth
        );
        break;
      case 'page-height':
        ratio = pdfContainerHeight / viewportHeight;
        break;
      case 'page-width':
      default:
        ratio = pdfContainerWidth / viewportWidth;
        break;
    }

    return (this._zoom() * ratio) / PdfViewerComponent.CSS_UNITS;
  }

  private resetPdfDocument() {
    this.pdfLinkService.setDocument(this._pdf, null);
    this.pdfFindController.setDocument(this._pdf!);
    this.pdfViewer.setDocument(this._pdf!);
  }

  private initialize(): void {
    if (isSSR() || !this.isVisible) {
      return;
    }

    this.isInitialized = true;
    this.initEventBus();
    this.setupViewer();
  }

  private setupResizeListener(): void {
    if (isSSR()) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      fromEvent(window, 'resize')
        .pipe(
          debounceTime(100),
          filter(() => this.autoresize() && !!this._pdf),
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          this.updateSize();
        });
    });
  }
}
