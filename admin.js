const apiBase = 'https://tarvika.gsthelper0.workers.dev';
const loginForm = document.getElementById('admin-login-form');
const loginButton = document.getElementById('admin-login-button');
const loginStatus = document.getElementById('admin-login-status');
const loginPanel = document.getElementById('admin-login');
const dashboard = document.getElementById('admin-dashboard');
const applicationList = document.getElementById('admission-list');
const detailPanel = document.getElementById('admission-detail');
const emptyPanel = document.getElementById('admission-empty');
let idToken = '';
let applications = [];
let selectedKey = '';
let activeObjectUrls = [];

async function api(path, options = {}) {
  const headers = {};
  if (options.body) headers['Content-Type'] = 'application/json';
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Request failed. Please try again.');
  return result;
}

function text(parent, tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value || 'Not provided';
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function appKey(ownerUid, reference) {
  return `${ownerUid}/${reference}`;
}

function currency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function readFees(application) {
  return application.fees || {};
}

function updateFeePreview() {
  const number = name => Math.max(0, Number(document.getElementById(`fee-${name}`).value) || 0);
  const total = Math.max(0, number('tuition') + number('registration') + number('materials') + number('other') - number('discount') - number('scholarship'));
  const paid = number('paid');
  document.getElementById('fee-total-preview').textContent = currency(total);
  document.getElementById('fee-balance-preview').textContent = currency(Math.max(0, total - paid));
}

async function loadApplications(preferredKey = '') {
  const result = await api('/api/admin/admissions');
  applications = [];
  Object.entries(result.admissions || {}).forEach(([ownerUid, records]) => {
    Object.entries(records || {}).forEach(([reference, application]) => applications.push({ ownerUid, reference, application }));
  });
  applications.sort((a, b) => (b.application.submittedAt || 0) - (a.application.submittedAt || 0));
  document.getElementById('admission-count').textContent = `${applications.length} application${applications.length === 1 ? '' : 's'}`;
  applicationList.replaceChildren();
  if (!applications.length) {
    text(applicationList, 'p', 'No admission applications yet.', 'portal-empty');
    detailPanel.hidden = true;
    emptyPanel.hidden = false;
    return;
  }
  applications.forEach(item => {
    const key = appKey(item.ownerUid, item.reference);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'portal-list-item';
    button.dataset.key = key;
    button.setAttribute('aria-current', String(key === (preferredKey || selectedKey)));
    text(button, 'strong', item.application.studentName || 'Student application');
    text(button, 'span', `${item.reference} · ${item.application.program || 'Program not selected'}`);
    text(button, 'span', `${(item.application.status || 'submitted').replaceAll('_', ' ')} · ${item.application.email || item.ownerUid}`);
    button.addEventListener('click', () => showApplication(key));
    applicationList.append(button);
  });
  const key = preferredKey || (applications.some(item => appKey(item.ownerUid, item.reference) === selectedKey) ? selectedKey : appKey(applications[0].ownerUid, applications[0].reference));
  await showApplication(key);
}

async function renderPrivateFiles(container, files) {
  const section = document.createElement('section');
  section.className = 'portal-messages';
  text(section, 'h3', 'Private uploaded documents');
  const grid = document.createElement('div');
  grid.className = 'admin-files';
  for (const file of files || []) {
    const item = document.createElement('div');
    item.className = 'admin-file';
    text(item, 'span', `${file.category || 'Document'} · ${file.name || ''}`);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Load preview';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Loading…';
      try {
        const response = await fetch(`${apiBase}/api/admissions/files/${encodeURIComponent(file.key)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) throw new Error('Document access denied');
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        activeObjectUrls.push(objectUrl);
        if (blob.type.startsWith('image/')) {
          const image = document.createElement('img');
          image.src = objectUrl;
          image.alt = file.category || 'Admission document';
          item.prepend(image);
        } else {
          const link = document.createElement('a');
          link.href = objectUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Open PDF';
          item.append(link);
        }
        button.remove();
      } catch (error) {
        button.textContent = error.message;
        button.disabled = false;
      }
    });
    item.append(button);
    grid.append(item);
  }
  if (!files?.length) text(grid, 'p', 'No files attached.', 'portal-empty');
  section.append(grid);
  container.append(section);
}

async function showApplication(key) {
  const item = applications.find(entry => appKey(entry.ownerUid, entry.reference) === key);
  if (!item) return;
  selectedKey = key;
  applicationList.querySelectorAll('.portal-list-item').forEach(button => button.setAttribute('aria-current', String(button.dataset.key === key)));
  activeObjectUrls.forEach(URL.revokeObjectURL);
  activeObjectUrls = [];
  emptyPanel.hidden = true;
  detailPanel.hidden = false;
  detailPanel.replaceChildren();

  const { ownerUid, reference, application } = item;
  const heading = document.createElement('div');
  heading.className = 'portal-detail-title';
  const title = document.createElement('div');
  text(title, 'p', `${reference} · ${ownerUid}`);
  text(title, 'h2', application.studentName);
  text(title, 'p', `${application.program || 'Program not selected'} · ${application.email || ''}`);
  const badge = text(heading, 'span', (application.status || 'submitted').replaceAll('_', ' '), 'portal-status');
  badge.dataset.status = application.status || '';
  heading.prepend(title);
  detailPanel.append(heading);

  const details = document.createElement('dl');
  details.className = 'admin-student-data';
  const rows = [
    ['Email', application.email], ['Mobile', application.mobileNumber], ['WhatsApp', application.whatsappNumber],
    ['Date of birth', application.dateOfBirth], ['Gender', application.gender], ['Nationality', application.nationality],
    ['Parent / guardian', application.guardianName], ['Relationship', application.guardianRelation],
    ['Guardian phone', application.guardianPhone], ['Guardian email', application.guardianEmail],
    ['Guardian occupation', application.guardianOccupation], ['Emergency contact', application.emergencyName],
    ['Emergency phone', application.emergencyPhone], ['Registered address', application.address],
    ['Permanent address', application.permanentAddress], ['City', application.city],
    ['Qualification', `${application.qualification || ''} · ${application.qualificationStatus || ''}`],
    ['School / college', application.institutionName], ['Institution city', application.institutionCity],
  ];
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'admin-student-row';
    text(row, 'dt', label);
    text(row, 'dd', value);
    details.append(row);
  });
  detailPanel.append(details);
  await renderPrivateFiles(detailPanel, application.files);

  const fee = readFees(application);
  const feePanel = document.createElement('form');
  feePanel.className = 'fee-editor';
  text(feePanel, 'h3', 'Fee setup and payment tracking');
  text(feePanel, 'p', 'Enter approved amounts in INR. No fee is assumed; total and balance are calculated automatically.');
  const grid = document.createElement('div');
  grid.className = 'fee-grid';
  const feeFields = [
    ['tuition', 'Tuition fee'], ['registration', 'Registration fee'], ['materials', 'Materials / lab'],
    ['other', 'Other charge'], ['discount', 'Discount'], ['scholarship', 'Scholarship'], ['paid', 'Amount paid'],
  ];
  feeFields.forEach(([key, label]) => {
    const field = document.createElement('div');
    field.className = 'fee-field';
    const inputLabel = document.createElement('label');
    inputLabel.htmlFor = `fee-${key}`;
    inputLabel.textContent = label;
    const input = document.createElement('input');
    input.id = `fee-${key}`;
    input.name = key;
    input.type = 'number';
    input.min = '0';
    input.max = '10000000';
    input.step = '0.01';
    input.required = key === 'tuition';
    input.value = fee[key] ?? '';
    input.addEventListener('input', updateFeePreview);
    field.append(inputLabel, input);
    grid.append(field);
  });
  feePanel.append(grid);
  const summary = document.createElement('div');
  summary.className = 'fee-summary';
  const totalBox = document.createElement('div');
  text(totalBox, 'span', 'Total payable');
  text(totalBox, 'strong', currency(fee.total), undefined).id = 'fee-total-preview';
  const balanceBox = document.createElement('div');
  text(balanceBox, 'span', 'Balance due');
  text(balanceBox, 'strong', currency(fee.balance), undefined).id = 'fee-balance-preview';
  summary.append(totalBox, balanceBox);
  feePanel.append(summary);
  const reviewGrid = document.createElement('div');
  reviewGrid.className = 'review-form';
  const statusLabel = document.createElement('label');
  statusLabel.textContent = 'Admission decision';
  const statusSelect = document.createElement('select');
  statusSelect.required = true;
  [['under_review', 'Under review'], ['documents_requested', 'Documents requested'], ['approved', 'Approved'], ['declined', 'Declined'], ['enrolled', 'Enrolled']].forEach(([value, label]) => statusSelect.add(new Option(label, value)));
  statusSelect.value = ['under_review', 'documents_requested', 'approved', 'declined', 'enrolled'].includes(application.status) ? application.status : 'under_review';
  statusLabel.append(statusSelect);
  const noteLabel = document.createElement('label');
  noteLabel.textContent = 'Note for student';
  const noteInput = document.createElement('textarea');
  noteInput.maxLength = 3000;
  noteInput.value = application.reviewNote || '';
  noteInput.placeholder = 'Share next steps, missing documents or admission decision details.';
  noteLabel.append(noteInput);
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'button button-dark';
  saveButton.textContent = 'Save status and fee details';
  const saveStatus = document.createElement('p');
  saveStatus.className = 'portal-notice';
  saveStatus.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'admin-submit-row';
  actions.append(saveButton, saveStatus);
  reviewGrid.append(statusLabel, noteLabel, actions);
  feePanel.append(reviewGrid);
  feePanel.addEventListener('submit', async event => {
    event.preventDefault();
    if (!feePanel.reportValidity()) return;
    const fees = Object.fromEntries(feeFields.map(([key]) => [key, Number(feePanel.elements[key].value || 0)]));
    saveButton.disabled = true;
    saveStatus.textContent = 'Saving review…';
    try {
      await api('/api/admin/admissions/review', {
        method: 'POST',
        body: { ownerUid, reference, status: statusSelect.value, note: noteInput.value.trim(), fees },
      });
      await loadApplications(key);
    } catch (error) {
      saveStatus.textContent = error.message;
      saveStatus.classList.add('is-error');
      saveButton.disabled = false;
    }
  });
  detailPanel.append(feePanel);
  updateFeePreview();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  loginButton.disabled = true;
  loginStatus.classList.remove('is-error');
  loginStatus.textContent = 'Signing in and checking admin access…';
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('admin-email').value.trim(),
        password: document.getElementById('admin-password').value,
      },
    });
    idToken = result.idToken;
    document.getElementById('admin-account-label').textContent = `Signed in as ${result.email}`;
    await loadApplications();
    loginPanel.hidden = true;
    dashboard.hidden = false;
    loginStatus.textContent = '';
  } catch (error) {
    idToken = '';
    loginStatus.textContent = error.message;
    loginStatus.classList.add('is-error');
  } finally {
    loginButton.disabled = false;
  }
});

document.getElementById('refresh-admissions').addEventListener('click', async () => {
  const button = document.getElementById('refresh-admissions');
  button.disabled = true;
  try { await loadApplications(); } catch (error) { document.getElementById('admission-count').textContent = error.message; }
  finally { button.disabled = false; }
});

document.getElementById('admin-logout').addEventListener('click', () => {
  idToken = '';
  applications = [];
  selectedKey = '';
  activeObjectUrls.forEach(URL.revokeObjectURL);
  activeObjectUrls = [];
  dashboard.hidden = true;
  loginPanel.hidden = false;
  loginForm.reset();
  loginStatus.textContent = '';
});
