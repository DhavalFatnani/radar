// Allow TypeScript to accept side-effect CSS imports (e.g. import "./styles/tokens.css").
// These are plain global stylesheets, not CSS Modules — no exported shape.
declare module "*.css";
