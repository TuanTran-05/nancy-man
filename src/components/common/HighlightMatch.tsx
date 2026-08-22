import React from 'react';

export function highlightMatch(text: string, highlight: string): React.ReactNode {
  if (!highlight.trim()) return <>{text}</>;

  // Escape special regex characters in the search term
  const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escapedHighlight})`, 'gi'));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-yellow-200 text-heading rounded-sm px-[1px]">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
