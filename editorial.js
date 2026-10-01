document.querySelectorAll('[data-filter-controls]').forEach(controls => {
  const grid = document.getElementById(controls.dataset.filterControls);
  if (!grid) return;

  const cards = Array.from(grid.children).filter(card => card.matches('[data-category]'));
  const search = controls.querySelector('input[type="search"]');
  const buttons = Array.from(controls.querySelectorAll('[data-filter]'));
  const status = document.getElementById(controls.dataset.results);
  const emptyState = document.getElementById(controls.dataset.empty);
  let activeFilter = 'all';

  const updateResults = () => {
    const query = search ? search.value.trim().toLocaleLowerCase() : '';
    let visibleCount = 0;

    cards.forEach(card => {
      const categories = (card.dataset.category || '').split(/\s+/);
      const searchableText = `${card.textContent} ${card.dataset.search || ''}`.toLocaleLowerCase();
      const matchesCategory = activeFilter === 'all' || categories.includes(activeFilter);
      const matchesSearch = !query || searchableText.includes(query);
      const isVisible = matchesCategory && matchesSearch;

      card.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });

    if (status) {
      const itemName = grid.id === 'blog-grid' ? 'field notes' : 'resources';
      status.textContent = `Showing ${visibleCount} of ${cards.length} ${itemName}.`;
    }
    if (emptyState) emptyState.hidden = visibleCount > 0;
  };

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter;
      buttons.forEach(option => {
        const isActive = option === button;
        option.classList.toggle('is-active', isActive);
        option.setAttribute('aria-pressed', String(isActive));
      });
      updateResults();
    });
  });

  if (search) search.addEventListener('input', updateResults);
  updateResults();
});
