const apiBase = 'https://tarvika.gsthelper0.workers.dev';
const loginForm = document.getElementById('admission-login-form');
const loginButton = document.getElementById('admission-login-button');
const loginStatus = document.getElementById('admission-login-status');
const loginPanel = document.getElementById('admission-login');
const dashboard = document.getElementById('admission-dashboard');
const admissionForm = document.getElementById('admission-form');
const admissionStatus = document.getElementById('admission-status');
const submitButton = document.getElementById('submit-admission');
let idToken = '';
let studentRegistration = null;

async function api(path, options = {}) {
  const headers = {};
  if (options.json) headers['Content-Type'] = 'application/json';
  if (options.file) {
    headers['Content-Type'] = options.file.type;
    headers['X-File-Kind'] = options.category;
    headers['X-File-Name'] = options.file.name;
  }
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.file || (options.json ? JSON.stringify(options.body) : undefined),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Request failed. Please try again.');
  return result;
}

function renderRegistration(registration) {
  studentRegistration = registration;
  const fields = [
    ['Student name', registration.studentName], ['Email', registration.email],
    ['Mobile', registration.mobileNumber], ['WhatsApp', registration.whatsappNumber],
    ['Registered address', registration.address], ['City', registration.city],
    ['Registered program', registration.program], ['Qualification', registration.qualification],
    ['Qualification status', registration.qualificationStatus], ['Degree / stream', registration.degree],
    ['School / college', registration.institutionName], ['Institution city', registration.institutionCity],
  ];
  const container = document.getElementById('registration-prefill');
  container.replaceChildren(...fields.map(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'portal-data-row';
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    definition.textContent = value || 'Not provided';
    row.append(term, definition);
    return row;
  }));

  const programSelect = document.getElementById('admission-program');
  const matchingProgram = [...programSelect.options].find(option => option.value === registration.program || option.textContent.trim() === registration.program);
  if (matchingProgram) programSelect.value = matchingProgram.value;
  const qualification = document.getElementById('admission-qualification');
  if ([...qualification.options].some(option => option.value === registration.qualification)) qualification.value = registration.qualification;
  const status = document.getElementById('admission-qualification-status');
  if ([...status.options].some(option => option.value === registration.qualificationStatus)) status.value = registration.qualificationStatus;
  document.getElementById('admission-institution').value = registration.institutionName || '';
  document.getElementById('admission-institution-city').value = registration.institutionCity || '';
  document.getElementById('permanent-address').value = registration.address || '';
}

function renderExistingAdmissions(admissions) {
  const panel = document.getElementById('existing-admissions');
  const entries = Object.entries(admissions || {});
  if (!entries.length) {
    panel.hidden = true;
    return;
  }
  panel.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = 'Previous admission applications';
  panel.append(heading);
  entries.sort((a, b) => (b[1].submittedAt || 0) - (a[1].submittedAt || 0)).forEach(([reference, application]) => {
    const details = document.createElement('p');
    const feeText = application.fees
      ? ` · Total fee: ₹${Number(application.fees.total || 0).toLocaleString('en-IN')} · Balance: ₹${Number(application.fees.balance || 0).toLocaleString('en-IN')}`
      : ' · Fee details pending admin review';
    details.textContent = `${reference} · ${application.program || ''} · Status: ${(application.status || 'submitted').replaceAll('_', ' ')}${feeText}`;
    panel.append(details);
  });
  panel.hidden = false;
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  loginButton.disabled = true;
  loginStatus.classList.remove('is-error');
  loginStatus.textContent = 'Signing in and loading your registration…';
  try {
    const credentials = await api('/api/auth/login', {
      method: 'POST',
      json: true,
      body: {
        email: document.getElementById('admission-email').value.trim(),
        password: document.getElementById('admission-password').value,
      },
    });
    idToken = credentials.idToken;
    const result = await api('/api/admissions/me');
    renderRegistration(result.registration);
    renderExistingAdmissions(result.admissions);
    document.getElementById('student-account-label').textContent = `Signed in as ${credentials.email}`;
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

admissionForm.addEventListener('submit', async event => {
  event.preventDefault();
  admissionStatus.textContent = '';
  admissionStatus.classList.remove('is-error');
  if (!admissionForm.reportValidity()) return;
  if (!studentRegistration || !idToken) {
    admissionStatus.textContent = 'Sign in with your registered student account first.';
    admissionStatus.classList.add('is-error');
    return;
  }

  const fileInputs = [
    ['student-photo', 'student-photo'], ['guardian-photo', 'guardian-photo'],
    ['marksheet', 'marksheet'], ['identity-proof', 'identity-proof'], ['address-proof', 'address-proof'],
  ];
  const selectedFiles = [];
  for (const [id, category] of fileInputs) {
    const file = document.getElementById(id).files[0];
    if (!file) {
      if (category === 'student-photo') {
        admissionStatus.textContent = 'Choose a student photo to continue.';
        admissionStatus.classList.add('is-error');
        return;
      }
      continue;
    }
    if (file.size >= 2 * 1024 * 1024) {
      admissionStatus.textContent = `${file.name} must be smaller than 2 MB.`;
      admissionStatus.classList.add('is-error');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)
      || (category.endsWith('photo') && !file.type.startsWith('image/'))) {
      admissionStatus.textContent = `${file.name} has an unsupported file type.`;
      admissionStatus.classList.add('is-error');
      return;
    }
    selectedFiles.push({ category, file });
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Uploading documents…';
  const uploadedFiles = [];
  try {
    for (const { category, file } of selectedFiles) {
      admissionStatus.textContent = `Uploading ${file.name}…`;
      const result = await api('/api/admissions/files', { method: 'POST', file, category });
      uploadedFiles.push(result.file);
    }

    const data = new FormData(admissionForm);
    const fields = [
      'dateOfBirth', 'gender', 'nationality', 'guardianName', 'guardianRelation', 'guardianPhone',
      'guardianEmail', 'guardianOccupation', 'permanentAddress', 'emergencyName', 'emergencyPhone',
      'program', 'qualification', 'qualificationStatus', 'institutionName', 'institutionCity',
    ];
    const body = Object.fromEntries(fields.map(field => [field, String(data.get(field) || '').trim()]));
    body.consent = data.get('consent') === 'on';
    body.files = uploadedFiles;
    admissionStatus.textContent = 'Saving admission application…';
    const result = await api('/api/admissions', { method: 'POST', json: true, body });
    const confirmation = document.createElement('div');
    confirmation.className = 'admission-success';
    const title = document.createElement('h3');
    title.textContent = 'Application received';
    const message = document.createElement('p');
    message.textContent = `Reference ${result.reference}. The admissions team will review it and update your portal with status and fee details.`;
    confirmation.append(title, message);
    admissionForm.before(confirmation);
    admissionForm.reset();
    if (studentRegistration) renderRegistration(studentRegistration);
    admissionStatus.textContent = '';
    window.scrollTo({ top: confirmation.getBoundingClientRect().top + window.scrollY - 30, behavior: 'smooth' });
  } catch (error) {
    admissionStatus.textContent = error.message || 'Could not submit admission application.';
    admissionStatus.classList.add('is-error');
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit admission application ↗';
  }
});

document.getElementById('admission-logout').addEventListener('click', () => {
  idToken = '';
  studentRegistration = null;
  dashboard.hidden = true;
  loginPanel.hidden = false;
  loginForm.reset();
  admissionStatus.textContent = '';
});
