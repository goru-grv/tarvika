const apiBase = 'https://tarvika.gsthelper0.workers.dev';
const loginForm = document.getElementById('admin-login-form');
const loginButton = document.getElementById('admin-login-button');
const loginStatus = document.getElementById('admin-login-status');
const loginPanel = document.getElementById('admin-login');
const dashboard = document.getElementById('admin-dashboard');
const submissionList = document.getElementById('admin-submission-list');
const detailPanel = document.getElementById('admin-detail');
const emptyPanel = document.getElementById('admin-empty');
let idToken = '';
let submissions = [];
let selectedKey = '';

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

function statusLabel(status) {
  return ({ submitted: 'Submitted', under_review: 'Under review', changes_requested: 'Changes requested', approved: 'Approved', declined: 'Declined' })[status] || status || 'Unknown';
}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text || 'Not provided';
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function keyFor(ownerUid, reference) {
  return `${ownerUid}/${reference}`;
}

async function loadQueue(preferredKey = '') {
  const result = await api('/api/admin/research-submissions');
  submissions = [];
  Object.entries(result.submissions || {}).forEach(([ownerUid, records]) => {
    Object.entries(records || {}).forEach(([reference, record]) => submissions.push({ ownerUid, reference, record }));
  });
  submissions.sort((a, b) => (b.record.submittedAt || 0) - (a.record.submittedAt || 0));
  document.getElementById('admin-count').textContent = `${submissions.length} proposal${submissions.length === 1 ? '' : 's'}`;
  submissionList.replaceChildren();
  if (!submissions.length) {
    addText(submissionList, 'p', 'The review queue is empty.', 'portal-empty');
    emptyPanel.hidden = false;
    detailPanel.hidden = true;
    return;
  }
  submissions.forEach(item => {
    const key = keyFor(item.ownerUid, item.reference);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'portal-list-item';
    button.dataset.key = key;
    button.setAttribute('aria-current', String(key === (preferredKey || selectedKey)));
    addText(button, 'strong', item.record.researchTitle);
    addText(button, 'span', `${item.reference} · ${item.record.fullName || item.record.email || item.ownerUid}`);
    addText(button, 'span', `${item.record.researchField || 'Unclassified'} · ${statusLabel(item.record.status)}`);
    button.addEventListener('click', () => showSubmission(key));
    submissionList.append(button);
  });
  const selection = preferredKey || (submissions.some(item => keyFor(item.ownerUid, item.reference) === selectedKey) ? selectedKey : keyFor(submissions[0].ownerUid, submissions[0].reference));
  showSubmission(selection);
}

function showSubmission(key) {
  const item = submissions.find(entry => keyFor(entry.ownerUid, entry.reference) === key);
  if (!item) return;
  selectedKey = key;
  submissionList.querySelectorAll('.portal-list-item').forEach(button => button.setAttribute('aria-current', String(button.dataset.key === key)));
  emptyPanel.hidden = true;
  detailPanel.hidden = false;
  detailPanel.replaceChildren();

  const { record, ownerUid, reference } = item;
  const heading = document.createElement('div');
  heading.className = 'portal-detail-title';
  const title = document.createElement('div');
  addText(title, 'p', `${reference} · ${ownerUid}`);
  addText(title, 'h2', record.researchTitle);
  addText(title, 'p', `${record.fullName || 'Researcher'} · ${record.email || 'No email'} · ${record.researchField || 'No field'}`);
  const badge = addText(heading, 'span', statusLabel(record.status), 'portal-status');
  badge.dataset.status = record.status || '';
  heading.prepend(title);
  detailPanel.append(heading);

  const details = document.createElement('dl');
  details.className = 'portal-data';
  const rows = [
    ['Researcher', record.fullName], ['Contact email', record.email], ['Phone', record.phone],
    ['Organization', record.organization], ['City', record.city], ['Research team', record.teamName],
    ['Mentor', record.mentorName], ['Mentor email', record.mentorEmail], ['Mentor role', record.mentorRole],
    ['Field', record.researchField], ['Topic', record.researchTopic], ['Stage', record.researchStage],
    ['Collaboration requested', record.collaborationType], ['Research summary', record.researchSummary, true],
    ['Fit with TARVIKA', record.criteriaFit, true], ['Supporting link', record.supportingLink],
  ];
  rows.forEach(([label, value, wide]) => {
    const row = document.createElement('div');
    row.className = `portal-data-row${wide ? ' portal-data-row-wide' : ''}`;
    addText(row, 'dt', label);
    if (label === 'Supporting link' && value) {
      const definition = document.createElement('dd');
      const link = document.createElement('a');
      link.href = value;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = value;
      definition.append(link);
      row.append(definition);
    } else addText(row, 'dd', value);
    details.append(row);
  });
  detailPanel.append(details);

  const messagesSection = document.createElement('section');
  messagesSection.className = 'portal-messages';
  addText(messagesSection, 'h3', 'Conversation');
  const messages = Object.values(record.messages || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const messageList = document.createElement('div');
  messageList.className = 'message-list';
  if (!messages.length) addText(messageList, 'p', 'No conversation messages yet.', 'portal-empty');
  messages.forEach(message => {
    const entry = document.createElement('article');
    entry.className = 'message-item';
    entry.dataset.role = message.authorRole || 'researcher';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    addText(meta, 'span', message.authorRole === 'admin' ? `TARVIKA team · ${message.authorEmail || ''}` : `Researcher · ${message.authorEmail || ''}`);
    addText(meta, 'time', message.createdAt ? new Date(message.createdAt).toLocaleString() : 'Just now');
    entry.append(meta);
    addText(entry, 'p', message.message);
    messageList.append(entry);
  });
  messagesSection.append(messageList);

  const reviewForm = document.createElement('form');
  reviewForm.className = 'review-form';
  const statusLabelElement = document.createElement('label');
  statusLabelElement.textContent = 'Review status';
  const statusSelect = document.createElement('select');
  statusSelect.required = true;
  statusSelect.setAttribute('aria-label', 'Review status');
  [
    ['under_review', 'Under review'], ['changes_requested', 'Changes requested'],
    ['approved', 'Approved'], ['declined', 'Declined'],
  ].forEach(([value, label]) => statusSelect.add(new Option(label, value)));
  statusSelect.value = ['under_review', 'changes_requested', 'approved', 'declined'].includes(record.status) ? record.status : 'under_review';
  statusLabelElement.append(statusSelect);
  const messageLabel = document.createElement('label');
  messageLabel.textContent = 'Message for researcher';
  const messageInput = document.createElement('textarea');
  messageInput.required = true;
  messageInput.minLength = 2;
  messageInput.maxLength = 3000;
  messageInput.placeholder = 'Explain the decision, requested changes, or next step.';
  messageLabel.append(messageInput);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'button button-dark';
  submit.textContent = 'Save review and send message';
  const status = document.createElement('p');
  status.className = 'portal-notice';
  status.setAttribute('role', 'status');
  reviewForm.append(statusLabelElement, messageLabel, submit, status);
  reviewForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!reviewForm.reportValidity()) return;
    submit.disabled = true;
    status.textContent = 'Saving review…';
    try {
      await api('/api/admin/research-submissions/review', {
        method: 'POST',
        body: { ownerUid, reference, status: statusSelect.value, message: messageInput.value.trim() },
      });
      await loadQueue(key);
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
      submit.disabled = false;
    }
  });
  messagesSection.append(reviewForm);
  detailPanel.append(messagesSection);
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  loginButton.disabled = true;
  loginStatus.classList.remove('is-error');
  loginStatus.textContent = 'Signing in and checking admin access…';
  try {
    const auth = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('admin-email').value.trim(),
        password: document.getElementById('admin-password').value,
      },
    });
    idToken = auth.idToken;
    await loadQueue();
    document.getElementById('admin-account-label').textContent = `Signed in as ${auth.email}`;
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

document.getElementById('refresh-queue').addEventListener('click', async () => {
  const button = document.getElementById('refresh-queue');
  button.disabled = true;
  try {
    await loadQueue();
  } catch (error) {
    document.getElementById('admin-count').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById('admin-logout').addEventListener('click', () => {
  idToken = '';
  submissions = [];
  selectedKey = '';
  dashboard.hidden = true;
  loginPanel.hidden = false;
  loginForm.reset();
  loginStatus.textContent = '';
});
