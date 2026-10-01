const registrationForm = document.getElementById('registration-form');
const qualificationSelect = document.getElementById('qualification');
const degreeField = document.getElementById('degree-field');
const degreeSelect = document.getElementById('degree');
const degreeLabel = document.getElementById('degree-label');
const formStatus = document.getElementById('form-status');
const submitButton = document.getElementById('submit-button');
const registrationSuccess = document.getElementById('registration-success');
const studentIdOutput = document.getElementById('student-id');
const registerTab = document.getElementById('register-tab');
const loginTab = document.getElementById('login-tab');
const registerPanel = document.getElementById('register-panel');
const loginPanel = document.getElementById('login-panel');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const loginButton = document.getElementById('login-button');
const profilePanel = document.getElementById('profile-panel');
let activeIdToken = '';
const degreeOptions = {
  '10th': { label: 'Degree / stream', values: ['Not applicable'] },
  '12th': { label: '12th stream', values: ['Science', 'Commerce', 'Arts/Humanities', 'Vocational', 'Other'] },
  UG: { label: 'Undergraduate degree', values: ['BA', 'BSc', 'BCom', 'BCA', 'BBA', 'BTech/BE', 'BPharm', 'BDes', 'LLB', 'Other'] },
  PG: { label: 'Postgraduate degree', values: ['MA', 'MSc', 'MCom', 'MCA', 'MBA', 'MTech/ME', 'MPharm', 'LLM', 'Other'] },
};
const workerEndpoint = 'https://tarvika.gsthelper0.workers.dev/api/registrations';
const workerBase = 'https://tarvika.gsthelper0.workers.dev';

async function callWorker(path, { method = 'GET', body, idToken } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const response = await fetch(`${workerBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Request failed. Please try again.');
  return result;
}

function setAccountMode(mode) {
  const isRegister = mode === 'register';
  registerTab.setAttribute('aria-selected', String(isRegister));
  loginTab.setAttribute('aria-selected', String(!isRegister));
  registerPanel.hidden = !isRegister;
  loginPanel.hidden = isRegister;
}

registerTab.addEventListener('click', () => setAccountMode('register'));
loginTab.addEventListener('click', () => setAccountMode('login'));

qualificationSelect.addEventListener('change', () => {
  const selected = degreeOptions[qualificationSelect.value];
  degreeSelect.replaceChildren(new Option('Select degree / stream', ''));
  degreeField.hidden = !selected || qualificationSelect.value === '10th';
  degreeSelect.required = Boolean(selected && qualificationSelect.value !== '10th');
  if (!selected) return;

  degreeLabel.innerHTML = `${selected.label} <span>*</span>`;
  selected.values.forEach(value => degreeSelect.add(new Option(value, value)));
});

registrationForm.addEventListener('submit', async event => {
  event.preventDefault();
  formStatus.textContent = '';
  formStatus.classList.remove('is-error');

  if (!registrationForm.reportValidity()) return;

  const formData = new FormData(registrationForm);
  const password = String(formData.get('password') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');
  const passwordConfirmation = registrationForm.elements.confirmPassword;
  passwordConfirmation.setCustomValidity(password === confirmPassword ? '' : 'Passwords do not match.');
  if (!registrationForm.reportValidity()) return;

  const qualification = formData.get('qualification');
  const payload = Object.fromEntries([
    'studentName', 'email', 'whatsappNumber', 'mobileNumber', 'address', 'city',
    'qualification', 'qualificationStatus', 'institutionName', 'institutionCity', 'program',
  ].map(key => [key, String(formData.get(key) || '').trim()]));
  payload.degree = qualification === '10th' ? 'Not applicable' : String(formData.get('degree') || '');
  payload.consent = formData.get('consent') === 'on';

  submitButton.disabled = true;
  submitButton.textContent = 'Submitting…';
  formStatus.textContent = 'Creating your account and saving registration…';

  try {
    if (!activeIdToken) {
      const account = await callWorker('/api/auth/register', {
        method: 'POST',
        body: { email: payload.email, password },
      });
      activeIdToken = account.idToken;
    }

    const result = await callWorker('/api/registrations', {
      method: 'POST',
      idToken: activeIdToken,
      body: payload,
    });
    if (!result.ok || !result.studentId) throw new Error('Registration could not be saved. Please try again.');

    studentIdOutput.textContent = result.studentId;
    registrationForm.elements.password.value = '';
    registrationForm.elements.confirmPassword.value = '';
    registrationForm.closest('.registration-section').hidden = true;
    registrationSuccess.hidden = false;
    registrationSuccess.focus();
  } catch (error) {
    formStatus.textContent = error.message || 'Could not connect. Please try again.';
    formStatus.classList.add('is-error');
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit registration <span aria-hidden="true">↗</span>';
  }
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginStatus.textContent = '';
  loginStatus.classList.remove('is-error');
  if (!loginForm.reportValidity()) return;

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in…';
  loginStatus.textContent = 'Checking your account…';

  try {
    const credentials = new FormData(loginForm);
    const account = await callWorker('/api/auth/login', {
      method: 'POST',
      body: {
        email: String(credentials.get('email') || '').trim(),
        password: String(credentials.get('password') || ''),
      },
    });
    activeIdToken = account.idToken;
    const result = await callWorker('/api/registrations/me', { idToken: activeIdToken });
    if (!result.ok || !result.registration) throw new Error('No saved registration was found for this account.');

    renderProfile(result.registration);
    loginForm.hidden = true;
    profilePanel.hidden = false;
    loginStatus.textContent = '';
  } catch (error) {
    activeIdToken = '';
    loginStatus.textContent = error.message || 'Could not sign in. Please try again.';
    loginStatus.classList.add('is-error');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Sign in';
  }
});

function renderProfile(registration) {
  document.getElementById('profile-id-line').textContent = `Student reference: ${registration.studentId || 'Not available'}`;
  const details = document.getElementById('profile-details');
  const labels = [
    ['studentName', 'Student name'], ['email', 'Email'], ['whatsappNumber', 'WhatsApp'],
    ['mobileNumber', 'Mobile'], ['address', 'Address'], ['city', 'City'],
    ['qualification', 'Last qualification'], ['qualificationStatus', 'Status'],
    ['degree', 'Degree / stream'], ['institutionName', 'School / college'],
    ['institutionCity', 'Institution city'], ['program', 'Program of interest'],
  ];
  details.replaceChildren(...labels.map(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'profile-row';
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    value.textContent = registration[key] || 'Not provided';
    row.append(term, value);
    return row;
  }));
}

document.getElementById('logout-button').addEventListener('click', () => {
  activeIdToken = '';
  loginForm.reset();
  loginForm.hidden = false;
  profilePanel.hidden = true;
  loginStatus.textContent = '';
});

document.getElementById('copy-id').addEventListener('click', async event => {
  try {
    await navigator.clipboard.writeText(studentIdOutput.textContent);
    event.currentTarget.textContent = 'Copied';
  } catch {
    event.currentTarget.textContent = 'Select and copy ID';
  }
});

document.getElementById('download-id').addEventListener('click', () => {
  const content = [
    'TARVIKA Research and Technology',
    'Student registration reference',
    `Student name: ${registrationForm.elements.studentName.value.trim()}`,
    `Student ID: ${studentIdOutput.textContent}`,
    'Keep this ID for future communication. It is not a login credential.',
  ].join('\n');
  const file = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `${studentIdOutput.textContent}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
});

document.getElementById('year').textContent = new Date().getFullYear();