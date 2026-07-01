# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ng2-pdf-viewer is an Angular PDF viewer component library wrapping Mozilla's pdf.js (`pdfjs-dist`). It's published to npm as `ng2-pdf-viewer` and used as `<pdf-viewer>` in Angular apps.

## Commands

- **Install**: `npm install --legacy-peer-deps`
- **Dev server**: `npm start` (serves demo app at localhost:4200)
- **Build demo app**: `npm run build`
- **Run all tests**: `npm test` (single run, Chrome)
- **Run tests in watch mode**: `npm run test:w`
- **Run tests headless (CI)**: `npm run test:ci`
- **Package library for publishing**: `npm run packagr`

## Architecture

This repo serves two purposes: a publishable Angular library and a demo application. All components are **standalone** (no NgModules).

### Library (the published package)

- Entry point: `public_api.ts` — exports `PdfViewerComponent` and typings
- Core component: `src/app/pdf-viewer/pdf-viewer.component.ts` — standalone component, all rendering logic lives here
- Types: `src/app/pdf-viewer/typings.ts`
- Utilities: `src/app/utils/event-bus-utils.ts`, `src/app/utils/helpers.ts`
- Packaging config: `ng-package.json` (uses ng-packagr)

### Demo Application

- `src/app/app.component.ts` — standalone demo app that showcases the PDF viewer
- `src/main.ts` — bootstraps with `bootstrapApplication()` (no AppModule)
- Built to `dist/` for deployment

### Key Dependencies

- `pdfjs-dist` (4.8.69) — Mozilla's PDF rendering library; the component wraps its viewer classes (`PDFViewer`, `PDFLinkService`, `EventBus`)
- Angular 20 with ng-packagr for library builds
- Karma + Jasmine for unit tests
- esbuild-based application builder (`@angular-devkit/build-angular:application`)

### Component Design

`PdfViewerComponent` uses pdfjs-dist's `PDFViewer` (multi-page) or `PDFSinglePageViewer` depending on the `[show-all]` input. It manages:
- Document loading via `getDocument()`
- Page rendering with configurable zoom, rotation, text layer, and auto-resize
- Event bus for search functionality and page navigation
- SSR safety checks (guards against `window`/`document` access)

### Testing

- Unit tests use standalone components in TestBed (`imports: [Component]` pattern)
- No e2e tests currently (Protractor was removed during Angular 20 migration)
