const apiBase = 'https://tarvika.gsthelper0.workers.dev';
const loginForm = document.getElementById('researcher-login-form');
const loginButton = document.getElementById('researcher-login-button');
const loginStatus = document.getElementById('researcher-login-status');
const loginPanel = document.getElementById('researcher-login');
const dashboard = document.getElementById('researcher-dashboard');
const submissionList = document.getElementById('researcher-submission-list');
const detailPanel = document.getElementById('researcher-detail');
const emptyPanel = document.getElementById('researcher-empty');
let idToken = '';
let submissions = {};
let selectedReference = '';

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

function readableStatus(status) {
  return ({ submitted: 'Submitted', under_review: 'Under review', changes_requested: 'Changes requested', approved: 'Approved', declined: 'Declined' })[status] || status || 'Unknown';
}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text || 'Not provided';
  if (className) element.className = className;
  parent.append(element);
  return element;
}

async function loadSubmissions(preferredReference = '') {
  const result = await api('/api/research-submissions/mine');
  submissions = result.submissions || {};
  const entries = Object.entries(submissions).sort((left, right) => (right[1].submittedAt || 0) - (left[1].submittedAt || 0));
  document.getElementById('researcher-count').textContent = `${entries.length} submission${entries.length === 1 ? '' : 's'}`;
  submissionList.replaceChildren();
  if (!entries.length) {
    addText(submissionList, 'p', 'No research submissions are linked to this account yet.', 'portal-empty');
    detailPanel.hidden = true;
    emptyPanel.hidden = false;
    return;
  }

  entries.forEach(([reference, submission]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'portal-list-item';
    button.dataset.reference = reference;
    button.setAttribute('aria-current', String(reference === (preferredReference || selectedReference)));
    addText(button, 'strong', submission.researchTitle);
    addText(button, 'span', `${reference} · ${readableStatus(submission.status)}`);
    button.addEventListener('click', () => showSubmission(reference));
    submissionList.append(button);
  });
  const reference = preferredReference || (submissions[selectedReference] ? selectedReference : entries[0][0]);
  showSubmission(reference);
}

function showSubmission(reference) {
  const submission = submissions[reference];
  if (!submission) return;
  selectedReference = reference;
  submissionList.querySelectorAll('.portal-list-item').forEach(button => {
    button.setAttribute('aria-current', String(button.dataset.reference === reference));
  });
  emptyPanel.hidden = true;
  detailPanel.hidden = false;
  detailPanel.replaceChildren();

  const heading = document.createElement('div');
  heading.className = 'portal-detail-title';
  const title = document.createElement('div');
  addText(title, 'p', reference);
  addText(title, 'h2', submission.researchTitle);
  addText(title, 'p', `${submission.researchField || 'Field not set'} · ${submission.researchStage || 'Stage not set'}`);
  const badge = addText(heading, 'span', readableStatus(submission.status), 'portal-status');
  badge.dataset.status = submission.status || '';
  heading.prepend(title);
  detailPanel.append(heading);

  const details = document.createElement('dl');
  details.className = 'portal-data';
  const rows = [
    ['Researcher', submission.fullName], ['Contact email', submission.email], ['Team', submission.teamName],
    ['Institution', submission.organization], ['Mentor', submission.mentorName], ['Mentor role', submission.mentorRole],
    ['Mentor email', submission.mentorEmail], ['Topic', submission.researchTopic], ['Research stage', submission.researchStage],
    ['Collaboration requested', submission.collaborationType], ['Summary', submission.researchSummary, true],
    ['Fit with TARVIKA', submission.criteriaFit, true], ['Supporting link', submission.supportingLink],
    ['Admin review note', submission.adminFeedback, true],
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
  addText(messagesSection, 'h3', 'Follow-up conversation');
  const messageList = document.createElement('div');
  messageList.className = 'message-list';
  const messages = Object.values(submission.messages || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!messages.length) addText(messageList, 'p', 'No messages yet. Send a question or update to the TARVIKA team below.', 'portal-empty');
  messages.forEach(message => {
    const item = document.createElement('article');
    item.className = 'message-item';
    item.dataset.role = message.authorRole || 'researcher';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    addText(meta, 'span', message.authorRole === 'admin' ? 'TARVIKA team' : 'You');
    addText(meta, 'time', message.createdAt ? new Date(message.createdAt).toLocaleString() : 'Just now');
    item.append(meta);
    addText(item, 'p', message.message);
    messageList.append(item);
  });
  messagesSection.append(messageList);

  const form = document.createElement('form');
  form.className = 'portal-message-form';
  const textarea = document.createElement('textarea');
  textarea.name = 'message';
  textarea.required = true;
  textarea.maxLength = 3000;
  textarea.minLength = 2;
  textarea.placeholder = 'Write a follow-up, answer a review note or share an update…';
  const button = document.createElement('button');
  button.className = 'button button-dark';
  button.type = 'submit';
  button.textContent = 'Send message';
  const status = document.createElement('p');
  status.className = 'portal-notice';
  status.setAttribute('role', 'status');
  form.append(textarea, button, status);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    button.disabled = true;
    status.textContent = 'Sending…';
    try {
      await api(`/api/research-submissions/${encodeURIComponent(reference)}/messages`, {
        method: 'POST',
        body: { message: textarea.value.trim() },
      });
      await loadSubmissions(reference);
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
      button.disabled = false;
    }
  });
  messagesSection.append(form);
  detailPanel.append(messagesSection);
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  loginButton.disabled = true;
  loginStatus.classList.remove('is-error');
  loginStatus.textContent = 'Signing in…';
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('researcher-email').value.trim(),
        password: document.getElementById('researcher-password').value,
      },
    });
    idToken = result.idToken;
    document.getElementById('researcher-account-label').textContent = `Signed in as ${result.email}`;
    await loadSubmissions();
    loginPanel.hidden = true;
    dashboard.hidden = false;
  } catch (error) {
    idToken = '';
    loginStatus.textContent = error.message;
    loginStatus.classList.add('is-error');
  } finally {
    loginButton.disabled = false;
  }
});

document.getElementById('researcher-logout').addEventListener('click', () => {
  idToken = '';
  submissions = {};
  selectedReference = '';
  dashboard.hidden = true;
  loginPanel.hidden = false;
  loginForm.reset();
  loginStatus.textContent = '';
});
