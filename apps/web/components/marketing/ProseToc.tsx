type TocItem = { id: string; label: string };

export function ProseToc({ items }: { items: TocItem[] }) {
  if (items.length < 4) return null;
  return (
    <nav className="mkt-toc" aria-label="On this page">
      <p>On this page</p>
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`}>{item.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
