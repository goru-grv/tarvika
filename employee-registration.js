const employeeForm = document.getElementById('employee-form');
const employeeStatus = document.getElementById('employee-status');
const employeeSubmit = document.getElementById('employee-submit');
const employeeSuccess = document.getElementById('employee-success');
const referenceOutput = document.getElementById('employee-reference');
const motivationInput = document.getElementById('motivation');
const motivationCount = document.getElementById('motivation-count');
const employeeEndpoint = 'https://tarvika.gsthelper0.workers.dev/api/employee-applications';

motivationInput.addEventListener('input', () => {
  motivationCount.textContent = String(motivationInput.value.length);
});

employeeForm.addEventListener('submit', async event => {
  event.preventDefault();
  employeeStatus.textContent = '';
  employeeStatus.classList.remove('is-error');
  if (!employeeForm.reportValidity()) return;

  const data = new FormData(employeeForm);
  const payload = Object.fromEntries([
    'fullName', 'email', 'phone', 'city', 'organization', 'roleType', 'roleInterest',
    'education', 'experience', 'skills', 'portfolioUrl', 'resumeUrl', 'availability', 'motivation',
  ].map(key => [key, String(data.get(key) || '').trim()]));
  payload.consent = data.get('consent') === 'on';

  employeeSubmit.disabled = true;
  employeeSubmit.textContent = 'Submitting…';
  employeeStatus.textContent = 'Sending your application securely…';

  try {
    const response = await fetch(employeeEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok || !result.reference) {
      throw new Error(result.error || 'Could not submit your application. Please try again.');
    }
    referenceOutput.textContent = result.reference;
    employeeForm.closest('.employee-main').hidden = true;
    document.querySelector('.employee-notice').hidden = true;
    employeeSuccess.hidden = false;
    employeeSuccess.focus();
  } catch (error) {
    employeeStatus.textContent = error.message || 'Could not connect. Please try again.';
    employeeStatus.classList.add('is-error');
    employeeSubmit.disabled = false;
    employeeSubmit.innerHTML = 'Submit application <span aria-hidden="true">↗</span>';
  }
});

document.getElementById('copy-employee-reference').addEventListener('click', async event => {
  try {
    await navigator.clipboard.writeText(referenceOutput.textContent);
    event.currentTarget.textContent = 'Copied';
  } catch {
    event.currentTarget.textContent = 'Select and copy reference';
  }
});
