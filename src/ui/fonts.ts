/**
 * The bundled fonts (§3.2; SIL OFL 1.1, latin subsets, woff2, font-display swap). No font CDN and no
 * third-party request, ever. Atkinson Hyperlegible Next for everything, headings included (bold);
 * Fredoka 700 only for the amble wordmark; JetBrains Mono for code. (Games get their own Fredoka 600 as
 * bytes from src/app/player/fonts.ts, not from here.)
 */
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-600.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
