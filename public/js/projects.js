


/* ───────── 6. PROJECTS UI ───────── */

let projectsListStatus = 'active'; // 'active' or 'inactive'
let projectsTableData = [];
let editingProjectId = null;

function openProjectModal(project) {
  editingProjectId = project.id;

  const modal = document.getElementById('project-edit-modal');
  const backdrop = document.getElementById('project-edit-backdrop');

  const titleEl = document.getElementById('project-edit-title');
  const nameInput = document.getElementById('project-edit-name');
  const customerInput = document.getElementById('project-edit-customer');
  const latInput = document.getElementById('project-edit-lat');
  const lngInput = document.getElementById('project-edit-lng');
  const radiusInput = document.getElementById('project-edit-radius'); // 👈 NEW
  const tzSelect = document.getElementById('project-edit-timezone');
  const msgEl = document.getElementById('project-edit-message');

  if (titleEl) {
    titleEl.textContent = `Project: ${project.name || ''}`;
  }
  if (nameInput) nameInput.value = project.name || '';
  if (customerInput) customerInput.value = project.customer_name || '';

  if (latInput) {
    latInput.value =
      project.geo_lat === null || project.geo_lat === undefined
        ? ''
        : project.geo_lat;
  }
  if (lngInput) {
    lngInput.value =
      project.geo_lng === null || project.geo_lng === undefined
        ? ''
        : project.geo_lng;
  }

  if (radiusInput) {
    radiusInput.value =
      project.geo_radius === null || project.geo_radius === undefined
        ? ''
        : project.geo_radius;
  }

  if (tzSelect) {
    tzSelect.value = project.project_timezone || 'America/Puerto_Rico';
  }

  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }

  if (modal) modal.classList.remove('hidden');
  if (backdrop) backdrop.classList.remove('hidden');
}

function closeProjectEditModal() {
  editingProjectId = null;
  const modal = document.getElementById('project-edit-modal');
  const backdrop = document.getElementById('project-edit-backdrop');
  const msgEl = document.getElementById('project-edit-message');

  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }
}

async function saveProjectFromModal() {
  const msgEl = document.getElementById('project-edit-message');
  const nameInput = document.getElementById('project-edit-name');
  const customerInput = document.getElementById('project-edit-customer');
  const latInput = document.getElementById('project-edit-lat');
  const lngInput = document.getElementById('project-edit-lng');
  const radiusInput = document.getElementById('project-edit-radius'); // 👈 NEW
  const tzSelect = document.getElementById('project-edit-timezone');

  if (!editingProjectId) {
    if (msgEl) {
      msgEl.textContent = 'No project selected.';
      msgEl.style.color = 'red';
    }
    return;
  }

  const name = nameInput ? nameInput.value.trim() : '';
  const customer_name = customerInput ? customerInput.value.trim() : '';

  const latStr = latInput ? latInput.value.trim() : '';
  const lngStr = lngInput ? lngInput.value.trim() : '';
  const radiusStr = radiusInput ? radiusInput.value.trim() : ''; // 👈 NEW
  const project_timezone = tzSelect ? (tzSelect.value || null) : null;

  const geo_lat = latStr === '' ? null : Number(latStr);
  const geo_lng = lngStr === '' ? null : Number(lngStr);
  const geo_radius = radiusStr === '' ? null : Number(radiusStr); // 👈 NEW

  // coordinate validation
  if ((geo_lat === null) !== (geo_lng === null)) {
    if (msgEl) {
      msgEl.textContent =
        'Please enter both latitude and longitude, or leave both blank.';
      msgEl.style.color = 'red';
    }
    return;
  }

  if (
    (geo_lat !== null && Number.isNaN(geo_lat)) ||
    (geo_lng !== null && Number.isNaN(geo_lng))
  ) {
    if (msgEl) {
      msgEl.textContent = 'Invalid geofence coordinates.';
      msgEl.style.color = 'red';
    }
    return;
  }

  // radius validation (optional but nice)
  if (geo_radius !== null) {
    if (Number.isNaN(geo_radius) || geo_radius < 0) {
      if (msgEl) {
        msgEl.textContent = 'Geofence radius must be a non-negative number.';
        msgEl.style.color = 'red';
      }
      return;
    }
  }

  try {
    await fetchJSON('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingProjectId,
        name,
        customer_name,
        geo_lat,
        geo_lng,
        geo_radius, // 👈 now actually defined
        project_timezone
      })
    });

    if (msgEl) {
      msgEl.textContent = 'Geofence updated.';
      msgEl.style.color = 'green';
    }

    await loadProjectsTable();
    closeProjectEditModal();
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error: ' + err.message;
      msgEl.style.color = 'red';
    }
  }
}

async function loadProjectsForTimeEntries() {
  const entrySelect = document.getElementById('te-project');
  const filterSelect = document.getElementById('te-filter-project');

  if (!entrySelect && !filterSelect) return;

  if (entrySelect) {
    entrySelect.innerHTML = '<option value="">(select project)</option>';
  }
  if (filterSelect) {
    filterSelect.innerHTML = '<option value="">(all projects)</option>';
  }

  try {
    const projects = await fetchJSON('/api/projects?status=active');
    if (!projects.length) return;

    projects.forEach(p => {
      const label = p.customer_name
        ? `${p.customer_name} – ${p.name}`
        : p.name;

      if (entrySelect) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = label;
        entrySelect.appendChild(opt);
      }

      if (filterSelect) {
        const opt2 = document.createElement('option');
        opt2.value = p.id;
        opt2.textContent = label;
        filterSelect.appendChild(opt2);
      }
    });
  } catch (err) {
    console.error('Error loading projects:', err.message);
  }
}

async function loadProjectsTable() {
  const tbody = document.getElementById('projects-table-body');
  if (!tbody) return;

  tbody.innerHTML =
    projectsListStatus === 'active'
      ? '<tr><td colspan="3">Loading active projects...</td></tr>'
      : '<tr><td colspan="3">Loading inactive projects...</td></tr>';

  try {
    const projects = await fetchJSON(
      `/api/projects?status=${encodeURIComponent(projectsListStatus)}`
    );

    projectsTableData = projects || [];

    const term = projectsSearchInput ? projectsSearchInput.value : '';
    renderProjectsTable(term); // 👈 IMPORTANT
  } catch (err) {
    console.error('Error loading projects:', err.message);
    tbody.innerHTML =
      '<tr><td colspan="3">Error loading projects</td></tr>';
  }
}

const projectsSearchInput = document.getElementById('projects-search');
if (projectsSearchInput) {
  projectsSearchInput.addEventListener('input', () => {
    renderProjectsTable(projectsSearchInput.value);
  });
}

// 🔀 Toggle between Active / Inactive projects
const projectsToggleBtn = document.getElementById('projects-toggle-inactive');
if (projectsToggleBtn) {
  projectsToggleBtn.addEventListener('click', () => {
    if (projectsListStatus === 'active') {
      projectsListStatus = 'inactive';
      projectsToggleBtn.textContent = 'Show Active';
    } else {
      projectsListStatus = 'active';
      projectsToggleBtn.textContent = 'Show Inactive';
    }

    // Reload table for the new status
    loadProjectsTable();
  });
}


function renderProjectsTable(filterTerm = '') {
  const tbody = document.getElementById('projects-table-body');
  if (!tbody) return;

  const term = (filterTerm || '').toLowerCase().trim();

  let rows = projectsTableData || [];

  // 🔥 Hide top-level customers (only show jobs that have a customer)
  rows = rows.filter(p => p.customer_name);

  if (term) {
    rows = rows.filter(p => {
      const projectName = (p.name || '').toLowerCase();
      const customerName = (p.customer_name || '').toLowerCase();
      return (
        projectName.includes(term) ||
        customerName.includes(term)
      );
    });
  }


  if (!rows.length) {
    // Your table has 2 columns: Project, Customer
    tbody.innerHTML = `<tr><td colspan="2">No matching projects.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';

  rows.forEach(p => {
    const isActive =
      p.active === undefined ? true : p.active !== 0 && p.active !== false;
    const projectLabel = isActive
      ? (p.name || '')
      : `${p.name || ''} (inactive)`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${projectLabel}</td>
      <td>${p.customer_name || ''}</td>
    `;

    tr.addEventListener('click', () => openProjectModal(p));
    tbody.appendChild(tr);
  });
}
