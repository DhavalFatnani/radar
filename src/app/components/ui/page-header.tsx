export function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="page-header">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
    </header>
  );
}
