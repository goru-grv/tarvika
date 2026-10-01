const researchForm = document.getElementById('research-form');
const researchStatus = document.getElementById('research-status');
const researchSubmit = document.getElementById('research-submit');
const researchSuccess = document.getElementById('research-success');
const researchReference = document.getElementById('research-reference');
const summaryInput = document.getElementById('research-summary');
const summaryCount = document.getElementById('summary-count');
const researchEndpoint = 'https://tarvika.gsthelper0.workers.dev/api/research-submissions';
const workerBase = 'https://tarvika.gsthelper0.workers.dev';
const newAccountButton = document.getElementById('new-researcher-account');
const existingAccountButton = document.getElementById('existing-researcher-account');
const confirmationField = document.getElementById('confirm-password-field');
let useExistingAccount = false;

async function callWorker(path, options = {}) {
  const headers = {};
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.idToken) headers.Authorization = `Bearer ${options.idToken}`;
  const response = await fetch(`${workerBase}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Request failed. Please try again.');
  return result;
}

function setResearcherAccountMode(useExisting) {
  useExistingAccount = useExisting;
  newAccountButton.setAttribute('aria-pressed', String(!useExisting));
  existingAccountButton.setAttribute('aria-pressed', String(useExisting));
  confirmationField.hidden = useExisting;
  researchForm.elements.confirmPassword.required = !useExisting;
  researchForm.elements.password.autocomplete = useExisting ? 'current-password' : 'new-password';
  document.querySelector('label[for="research-password"]').firstChild.textContent = useExisting
    ? 'Account password '
    : 'Create account password ';
}

newAccountButton.addEventListener('click', () => setResearcherAccountMode(false));
existingAccountButton.addEventListener('click', () => setResearcherAccountMode(true));

summaryInput.addEventListener('input', () => {
  summaryCount.textContent = String(summaryInput.value.length);
});

researchForm.addEventListener('submit', async event => {
  event.preventDefault();
  researchStatus.textContent = '';
  researchStatus.classList.remove('is-error');
  if (!researchForm.reportValidity()) return;

  const data = new FormData(researchForm);
  const password = String(data.get('password') || '');
  if (!useExistingAccount) {
    const confirmation = researchForm.elements.confirmPassword;
    confirmation.setCustomValidity(password === String(data.get('confirmPassword') || '') ? '' : 'Passwords do not match.');
    if (!researchForm.reportValidity()) return;
  }

  const payload = Object.fromEntries([
    'fullName', 'email', 'phone', 'organization', 'city', 'teamName', 'mentorName',
    'mentorEmail', 'mentorRole', 'researchTitle', 'researchField', 'researchTopic',
    'researchSummary', 'researchStage', 'collaborationType', 'criteriaFit', 'supportingLink',
  ].map(key => [key, String(data.get(key) || '').trim()]));
  payload.consent = data.get('consent') === 'on';

  researchSubmit.disabled = true;
  researchSubmit.textContent = 'Submitting…';
  researchStatus.textContent = useExistingAccount ? 'Signing in and submitting proposal…' : 'Creating your researcher account and submitting…';

  try {
    const account = await callWorker(useExistingAccount ? '/api/auth/login' : '/api/auth/register', {
      method: 'POST',
      body: { email: payload.email, password },
    });
    const result = await callWorker(researchEndpoint.replace(workerBase, ''), {
      method: 'POST',
      idToken: account.idToken,
      body: payload,
    });
    if (!result.ok || !result.reference) {
      throw new Error(result.error || 'Could not submit the proposal. Please try again.');
    }

    researchReference.textContent = result.reference;
    researchForm.elements.password.value = '';
    researchForm.elements.confirmPassword.value = '';
    researchForm.closest('.submission-section').hidden = true;
    document.querySelector('.submission-notice').hidden = true;
    researchSuccess.hidden = false;
    researchSuccess.focus();
  } catch (error) {
    researchStatus.textContent = error.message || 'Could not connect. Please try again.';
    researchStatus.classList.add('is-error');
    researchSubmit.disabled = false;
    researchSubmit.innerHTML = 'Submit research proposal <span aria-hidden="true">↗</span>';
  }
});

document.getElementById('copy-reference').addEventListener('click', async event => {
  try {
    await navigator.clipboard.writeText(researchReference.textContent);
    event.currentTarget.textContent = 'Copied';
  } catch {
    event.currentTarget.textContent = 'Select and copy reference';
  }
});

document.getElementById('download-reference').addEventListener('click', () => {
  const content = [
    'TARVIKA Research and Technology',
    'Research collaboration submission reference',
    `Reference: ${researchReference.textContent}`,
    `Proposal: ${researchForm.elements.researchTitle.value.trim()}`,
    'This reference confirms receipt only, not acceptance or partnership.',
  ].join('\n');
  const file = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `${researchReference.textContent}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
});

document.getElementById('year').textContent = new Date().getFullYear();
