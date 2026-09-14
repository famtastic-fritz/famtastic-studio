// Separate fetch region: portfolio emptiness must not hide the studio library.
export function renderLibraryPanel(root, id, name) {
  const section = document.createElement('section');
  section.className = 'card';
  const heading = document.createElement('h2');
  heading.textContent = `${name} library`;
  const state = document.createElement('p');
  state.setAttribute('role', 'status');
  state.textContent = 'Loading pinned library catalog…';
  section.append(heading, state);
  root.append(section);
  fetch('/api/libraries', { headers: { Accept: 'application/json' } })
    .then(response => { if (!response.ok) throw new Error('Catalog request failed'); return response.json(); })
    .then(body => {
      const library = body.libraries?.find(entry => entry.id === id);
      if (!library || library.status !== 'available') {
        state.textContent = `Library unavailable: ${library?.reason || 'No catalog returned'}. Full studio platform remains planned.`;
        return;
      }
      state.textContent = `${library.entries.length} library records available at ${library.revision.slice(0, 12)}. Package readiness is recorded individually; the full studio platform remains planned.`;
      const link = document.createElement('a');
      link.href = library.repository_url;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'Open private library repository';
      section.append(link);
      const list = document.createElement('ul');
      for (const entry of library.entries) {
        const item = document.createElement('li');
        item.textContent = `${entry.name || entry.title || entry.id}${entry.version ? ` · ${entry.version}` : ''}${entry.description ? `: ${entry.description}` : ''}`;
        list.append(item);
      }
      section.append(list);
    })
    .catch(() => { state.textContent = 'Library could not be loaded. No availability claim is being made.'; });
  return section;
}
