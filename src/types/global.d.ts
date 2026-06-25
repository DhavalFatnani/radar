// Allow TypeScript to accept side-effect CSS imports (e.g. import "./styles/tokens.css")
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
