const ALLOWED_ORIGINS = new Set([
  'https://tarvikart.com',
  'https://www.tarvikart.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};

  if (!ALLOWED_ORIGINS.has(origin)) return null;

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Kind',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function getFirebaseIdToken(apiKey) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  if (!response.ok) throw new Error('Firebase anonymous sign-in failed');
  const result = await response.json();
  if (!result.idToken) throw new Error('Firebase did not return an ID token');
  return result.idToken;
}

async function callFirebaseAuth(apiKey, action, payload) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, returnSecureToken: true }),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = result.error?.message || '';
    if (code.includes('OPERATION_NOT_ALLOWED')) {
      const error = new Error('Enable Email/Password sign-in in Firebase Authentication settings.');
      error.status = 503;
      throw error;
    }
    if (code.includes('API_KEY_INVALID') || code.includes('API_KEY_SERVICE_BLOCKED') || code.includes('PROJECT_NOT_FOUND')) {
      const error = new Error('Firebase API key or project configuration is invalid. Check FIREBASE_API_KEY.');
      error.status = 503;
      throw error;
    }
    if (code.includes('EMAIL_EXISTS')) {
      const error = new Error('An account already exists for this email. Sign in instead.');
      error.status = 409;
      throw error;
    }
    if (code.includes('INVALID_LOGIN_CREDENTIALS') || code.includes('EMAIL_NOT_FOUND') || code.includes('INVALID_PASSWORD')) {
      throw new Error('Email or password is incorrect.');
    }
    if (code.includes('WEAK_PASSWORD')) {
      const error = new Error('Choose a password with at least 8 characters.');
      error.status = 400;
      throw error;
    }
    if (code.includes('INVALID_EMAIL')) {
      const error = new Error('Enter a valid email address.');
      error.status = 400;
      throw error;
    }
    const error = new Error(`Firebase authentication failed (${code || 'unknown error'}).`);
    error.status = 502;
    throw error;
  }
  if (!result.idToken || !result.localId) throw new Error('Firebase did not return a valid account session.');
  return { idToken: result.idToken, uid: result.localId, email: result.email || '' };
}

async function getFirebaseUser(apiKey, idToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!response.ok) return null;
  const result = await response.json();
  const user = result.users?.[0];
  return user?.localId && user.email
    ? { uid: user.localId, email: user.email.toLowerCase() }
    : null;
}

function getBearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function handleAccountAuth(request, env, cors, action) {
  if (!env.FIREBASE_API_KEY) {
    return json({ error: 'Firebase API key is not configured' }, 503, cors);
  }

  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(length) || length <= 0 || length > 8 * 1024) {
    return json({ error: 'Authentication request is invalid or too large' }, 413, cors);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400, cors);
  }

  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: 'Enter a valid email address.' }, 400, cors);
  }
  if (password.length < 8 || password.length > 128) {
    return json({ error: 'Password must be between 8 and 128 characters.' }, 400, cors);
  }

  try {
    const account = await callFirebaseAuth(
      env.FIREBASE_API_KEY,
      action === 'register' ? 'signUp' : 'signInWithPassword',
      { email, password },
    );
    return json({ ok: true, idToken: account.idToken, uid: account.uid, email: account.email }, 200, cors);
  } catch (error) {
    return json({ error: error.message || 'Firebase authentication failed.' }, error.status || 502, cors);
  }
}

async function getAuthenticatedFirebaseUser(request, env, cors) {
  const idToken = getBearerToken(request);
  if (!idToken) return { response: json({ error: 'Sign in to continue.' }, 401, cors) };

  try {
    const user = await getFirebaseUser(env.FIREBASE_API_KEY, idToken);
    if (!user) return { response: json({ error: 'Your session has expired. Sign in again.' }, 401, cors) };
    return { user, idToken };
  } catch {
    return { response: json({ error: 'Could not verify your Firebase session.' }, 502, cors) };
  }
}

async function saveEnquiry(request, env, cors) {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_API_KEY) {
    return json({ error: 'Firebase database configuration is incomplete' }, 503, cors);
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(env.FIREBASE_DATABASE_URL);
    if (databaseUrl.protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    return json({ error: 'Firebase database URL is invalid' }, 503, cors);
  }

  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(length) || length <= 0 || length > 16 * 1024) {
    return json({ error: 'Request must be between 1 byte and 16 KB' }, 413, cors);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400, cors);
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const program = typeof input.program === 'string' ? input.program.trim() : '';

  if (name.length < 2 || name.length > 100) {
    return json({ error: 'Name must be between 2 and 100 characters' }, 400, cors);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: 'A valid email address is required' }, 400, cors);
  }
  if (message.length < 5 || message.length > 5000) {
    return json({ error: 'Message must be between 5 and 5000 characters' }, 400, cors);
  }
  if (phone.length > 40 || subject.length > 160 || program.length > 120) {
    return json({ error: 'One or more optional fields are too long' }, 400, cors);
  }

  let accessToken;
  try {
    accessToken = await getFirebaseIdToken(env.FIREBASE_API_KEY);
  } catch {
    return json({ error: 'Firebase authentication is unavailable' }, 502, cors);
  }

  const databaseEndpoint = new URL(`${databaseUrl.toString().replace(/\/+$/, '')}/enquiries.json`);
  databaseEndpoint.searchParams.set('auth', accessToken);
  let response;
  try {
    response = await fetch(databaseEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        phone,
        subject,
        program,
        message,
        status: 'new',
        createdAt: { '.sv': 'timestamp' },
      }),
    });
  } catch {
    return json({ error: 'Firebase database is unavailable' }, 502, cors);
  }

  if (!response.ok) return json({ error: 'Could not save enquiry' }, 502, cors);
  const result = await response.json();
  return json({ ok: true, id: result.name }, 201, cors);
}

async function saveEmployeeApplication(request, env, cors) {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_API_KEY) {
    return json({ error: 'Firebase database configuration is incomplete' }, 503, cors);
  }

  const contentLength = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 16 * 1024) {
    return json({ error: 'Application must be between 1 byte and 16 KB' }, 413, cors);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400, cors);
  }

  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const city = typeof input.city === 'string' ? input.city.trim() : '';
  const roleType = typeof input.roleType === 'string' ? input.roleType : '';
  const roleInterest = typeof input.roleInterest === 'string' ? input.roleInterest.trim() : '';
  const education = typeof input.education === 'string' ? input.education.trim() : '';
  const experience = typeof input.experience === 'string' ? input.experience : '';
  const skills = typeof input.skills === 'string' ? input.skills.trim() : '';
  const portfolioUrl = typeof input.portfolioUrl === 'string' ? input.portfolioUrl.trim() : '';
  const resumeUrl = typeof input.resumeUrl === 'string' ? input.resumeUrl.trim() : '';
  const availability = typeof input.availability === 'string' ? input.availability : '';
  const motivation = typeof input.motivation === 'string' ? input.motivation.trim() : '';
  const consent = input.consent === true;

  const roleTypes = ['Full-time employee', 'Research associate', 'Internship applicant', 'Mentor / subject expert', 'Project collaborator'];
  const experienceOptions = ['No formal experience yet', 'Less than 1 year', '1–2 years', '3–5 years', 'More than 5 years'];
  const availabilityOptions = ['Immediate', 'Within 2 weeks', 'Within 1 month', 'Flexible / discuss'];

  if (fullName.length < 2 || fullName.length > 100) return json({ error: 'Enter a name between 2 and 100 characters' }, 400, cors);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Enter a valid email address' }, 400, cors);
  if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) return json({ error: 'Enter a valid phone number' }, 400, cors);
  if (city.length < 2 || city.length > 100 || education.length < 2 || education.length > 160) return json({ error: 'Enter your city and education background' }, 400, cors);
  if (!roleTypes.includes(roleType) || roleInterest.length < 3 || roleInterest.length > 160) return json({ error: 'Choose a valid role type and role interest' }, 400, cors);
  if (!experienceOptions.includes(experience) || !availabilityOptions.includes(availability)) return json({ error: 'Choose valid experience and availability options' }, 400, cors);
  if (skills.length < 2 || skills.length > 1200 || motivation.length < 40 || motivation.length > 3000) return json({ error: 'Add your skills and a 40–3000 character introduction' }, 400, cors);
  if (!consent) return json({ error: 'Confirm the application and privacy declaration' }, 400, cors);

  for (const link of [portfolioUrl, resumeUrl]) {
    if (!link) continue;
    try {
      const parsed = new URL(link);
      if (parsed.protocol !== 'https:' || link.length > 500) throw new Error('Invalid URL');
    } catch {
      return json({ error: 'Portfolio and CV links must be valid HTTPS URLs' }, 400, cors);
    }
  }

  let databaseUrl;
  let idToken;
  try {
    databaseUrl = new URL(env.FIREBASE_DATABASE_URL);
    if (databaseUrl.protocol !== 'https:') throw new Error('HTTPS required');
    idToken = await getFirebaseIdToken(env.FIREBASE_API_KEY);
  } catch {
    return json({ error: 'Firebase authentication or configuration is unavailable' }, 502, cors);
  }

  const reference = `EMP-${new Date().getUTCFullYear()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  const endpoint = new URL(`${databaseUrl.toString().replace(/\/+$/, '')}/employeeApplications/${reference}.json`);
  endpoint.searchParams.set('auth', idToken);
  try {
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference, fullName, email, phone, city, roleType, roleInterest, education,
        experience, skills, portfolioUrl, resumeUrl, availability, motivation,
        status: 'received', submittedAt: { '.sv': 'timestamp' },
      }),
    });
    if (!response.ok) return json({ error: 'Could not save employee application' }, 502, cors);
    return json({ ok: true, reference }, 201, cors);
  } catch {
    return json({ error: 'Firebase database is unavailable' }, 502, cors);
  }
}

async function saveResearchSubmission(request, env, cors) {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_API_KEY) {
    return json({ error: 'Firebase database configuration is incomplete' }, 503, cors);
  }

  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated.response;

  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(length) || length <= 0 || length > 32 * 1024) {
    return json({ error: 'Submission must be between 1 byte and 32 KB' }, 413, cors);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400, cors);
  }

  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const organization = typeof input.organization === 'string' ? input.organization.trim() : '';
  const city = typeof input.city === 'string' ? input.city.trim() : '';
  const teamName = typeof input.teamName === 'string' ? input.teamName.trim() : '';
  const mentorName = typeof input.mentorName === 'string' ? input.mentorName.trim() : '';
  const mentorEmail = typeof input.mentorEmail === 'string' ? input.mentorEmail.trim().toLowerCase() : '';
  const mentorRole = typeof input.mentorRole === 'string' ? input.mentorRole.trim() : '';
  const researchTitle = typeof input.researchTitle === 'string' ? input.researchTitle.trim() : '';
  const researchField = typeof input.researchField === 'string' ? input.researchField : '';
  const researchTopic = typeof input.researchTopic === 'string' ? input.researchTopic.trim() : '';
  const researchSummary = typeof input.researchSummary === 'string' ? input.researchSummary.trim() : '';
  const researchStage = typeof input.researchStage === 'string' ? input.researchStage : '';
  const collaborationType = typeof input.collaborationType === 'string' ? input.collaborationType : '';
  const criteriaFit = typeof input.criteriaFit === 'string' ? input.criteriaFit.trim() : '';
  const supportingLink = typeof input.supportingLink === 'string' ? input.supportingLink.trim() : '';
  const consent = input.consent === true;

  const fields = [
    'Artificial Intelligence & Machine Learning', 'Data Science', 'Software & Web Technologies',
    'Cybersecurity & Digital Forensics', 'Agriculture & Agri Tech', 'Space Technology',
    'Cloud, DevOps & Automation', 'Healthcare Technology', 'Education Technology',
    'Climate & Sustainability', 'Other',
  ];
  const stages = ['Idea', 'Literature review', 'Proposal', 'In progress', 'Prototype / pilot', 'Completed'];
  const collaborationTypes = [
    'Research discussion', 'Academic or university collaboration', 'Student / researcher project',
    'Mentorship or expert review', 'Industry or community collaboration', 'Workshop or knowledge exchange',
  ];

  if (fullName.length < 2 || fullName.length > 100) {
    return json({ error: 'Enter a name between 2 and 100 characters.' }, 400, cors);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: 'Enter a valid contact email.' }, 400, cors);
  }
  if (email !== authenticated.user.email) {
    return json({ error: 'Submission email must match the signed-in researcher account.' }, 403, cors);
  }
  if (phone.length > 30 || (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone))) {
    return json({ error: 'Enter a valid phone number.' }, 400, cors);
  }
  if (organization.length > 160 || city.length > 100 || teamName.length > 160) {
    return json({ error: 'Organization, city or team name is too long.' }, 400, cors);
  }
  if (mentorName.length > 100 || mentorEmail.length > 254 || mentorRole.length > 120) {
    return json({ error: 'Mentor details exceed the allowed length.' }, 400, cors);
  }
  if (mentorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mentorEmail)) {
    return json({ error: 'Enter a valid mentor email or leave it blank.' }, 400, cors);
  }
  if (researchTitle.length < 5 || researchTitle.length > 180 || researchTopic.length < 3 || researchTopic.length > 240) {
    return json({ error: 'Enter a research title and topic within the stated lengths.' }, 400, cors);
  }
  if (!fields.includes(researchField) || researchSummary.length < 40 || researchSummary.length > 6000) {
    return json({ error: 'Select a research field and provide a 40–6000 character summary.' }, 400, cors);
  }
  if (!stages.includes(researchStage) || !collaborationTypes.includes(collaborationType)) {
    return json({ error: 'Select a valid research stage and collaboration type.' }, 400, cors);
  }
  if (criteriaFit.length > 2000 || !consent) {
    return json({ error: 'Confirm the submission notice and keep eligibility details under 2000 characters.' }, 400, cors);
  }
  if (supportingLink) {
    try {
      const link = new URL(supportingLink);
      if (link.protocol !== 'https:' || supportingLink.length > 500) throw new Error('Invalid link');
    } catch {
      return json({ error: 'Supporting link must be a valid HTTPS URL.' }, 400, cors);
    }
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(env.FIREBASE_DATABASE_URL);
    if (databaseUrl.protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    return json({ error: 'Firebase database configuration is unavailable.' }, 503, cors);
  }

  const reference = `TRR-${new Date().getUTCFullYear()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  const databaseEndpoint = new URL(`${databaseUrl.toString().replace(/\/+$/, '')}/researchSubmissions/${authenticated.user.uid}/${reference}.json`);
  databaseEndpoint.searchParams.set('auth', authenticated.idToken);

  let response;
  try {
    response = await fetch(databaseEndpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference,
        fullName,
        email,
        phone,
        organization,
        city,
        teamName,
        mentorName,
        mentorEmail,
        mentorRole,
        researchTitle,
        researchField,
        researchTopic,
        researchSummary,
        researchStage,
        collaborationType,
        criteriaFit,
        supportingLink,
        status: 'submitted',
        messages: {},
        submittedAt: { '.sv': 'timestamp' },
      }),
    });
  } catch {
    return json({ error: 'Firebase database is unavailable.' }, 502, cors);
  }

  if (!response.ok) return json({ error: 'Could not save research submission.' }, 502, cors);
  return json({ ok: true, reference }, 201, cors);
}

function databaseEndpoint(env, path) {
  const base = new URL(env.FIREBASE_DATABASE_URL);
  if (base.protocol !== 'https:') throw new Error('HTTPS required');
  return new URL(`${base.toString().replace(/\/+$/, '')}/${path}.json`);
}

async function getResearcherSubmissions(request, env, cors) {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_API_KEY) {
    return json({ error: 'Firebase database configuration is incomplete' }, 503, cors);
  }
  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated.response;

  let endpoint;
  try {
    endpoint = databaseEndpoint(env, `researchSubmissions/${authenticated.user.uid}`);
  } catch {
    return json({ error: 'Firebase database URL is invalid' }, 503, cors);
  }
  endpoint.searchParams.set('auth', authenticated.idToken);
  try {
    const response = await fetch(endpoint);
    if (!response.ok) return json({ error: 'Could not load your research submissions' }, 502, cors);
    return json({ ok: true, submissions: await response.json() || {} }, 200, cors);
  } catch {
    return json({ error: 'Firebase database is unavailable' }, 502, cors);
  }
}

async function requireResearchAdmin(request, env, cors) {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_API_KEY || !env.ADMIN_UIDS) {
    return { response: json({ error: 'Admin access is not configured' }, 503, cors) };
  }
  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated;
  const adminUids = env.ADMIN_UIDS.split(',').map(uid => uid.trim()).filter(Boolean);
  if (!adminUids.includes(authenticated.user.uid)) {
    return { response: json({ error: 'Admin access required' }, 403, cors) };
  }

  let endpoint;
  try {
    endpoint = databaseEndpoint(env, `admins/${authenticated.user.uid}`);
  } catch {
    return { response: json({ error: 'Firebase database URL is invalid' }, 503, cors) };
  }
  endpoint.searchParams.set('auth', authenticated.idToken);
  try {
    const response = await fetch(endpoint);
    if (!response.ok || await response.json() !== true) {
      return { response: json({ error: 'Admin account is not enabled in the database' }, 403, cors) };
    }
  } catch {
    return { response: json({ error: 'Could not verify admin access' }, 502, cors) };
  }
  return authenticated;
}

async function getAdminResearchSubmissions(request, env, cors) {
  const admin = await requireResearchAdmin(request, env, cors);
  if (admin.response) return admin.response;
  let endpoint;
  try {
    endpoint = databaseEndpoint(env, 'researchSubmissions');
  } catch {
    return json({ error: 'Firebase database URL is invalid' }, 503, cors);
  }
  endpoint.searchParams.set('auth', admin.idToken);
  try {
    const response = await fetch(endpoint);
    if (!response.ok) return json({ error: 'Could not load the research queue' }, 502, cors);
    return json({ ok: true, submissions: await response.json() || {} }, 200, cors);
  } catch {
    return json({ error: 'Firebase database is unavailable' }, 502, cors);
  }
}

async function postResearchMessage(request, env, cors, reference) {
  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated.response;
  if (!/^TRR-[0-9]{4}-[A-F0-9]{10}$/.test(reference)) {
    return json({ error: 'Invalid submission reference' }, 400, cors);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400, cors);
  }
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length < 2 || message.length > 3000) {
    return json({ error: 'Message must be between 2 and 3000 characters' }, 400, cors);
  }

  const ownerUid = typeof input.ownerUid === 'string' ? input.ownerUid : authenticated.user.uid;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid)) return json({ error: 'Invalid researcher account' }, 400, cors);
  let authorRole = 'researcher';
  if (ownerUid !== authenticated.user.uid) {
    const admin = await requireResearchAdmin(request, env, cors);
    if (admin.response) return admin.response;
    authorRole = 'admin';
  }

  let endpoint;
  try {
    endpoint = databaseEndpoint(env, `researchSubmissions/${ownerUid}/${reference}/messages`);
  } catch {
    return json({ error: 'Firebase database URL is invalid' }, 503, cors);
  }
  endpoint.searchParams.set('auth', authenticated.idToken);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorUid: authenticated.user.uid,
        authorEmail: authenticated.user.email,
        authorRole,
        message,
        createdAt: { '.sv': 'timestamp' },
      }),
    });
    if (!response.ok) return json({ error: 'Could not send follow-up message' }, 502, cors);
    const result = await response.json();
    return json({ ok: true, messageId: result.name }, 201, cors);
  } catch {
    return json({ error: 'Firebase database is unavailable' }, 502, cors);
  }
}

async function reviewResearchSubmission(request, env, cors) {
  const admin = await requireResearchAdmin(request, env, cors);
  if (admin.response) return admin.response;
  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(length) || length <= 0 || length > 8 * 1024) {
    return json({ error: 'Review update is invalid or too large' }, 413, cors);
  }
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400, cors);
  }
  const ownerUid = typeof input.ownerUid === 'string' ? input.ownerUid : '';
  const reference = typeof input.reference === 'string' ? input.reference : '';
  const status = typeof input.status === 'string' ? input.status : '';
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  const allowedStatuses = ['under_review', 'changes_requested', 'approved', 'declined'];
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid) || !/^TRR-[0-9]{4}-[A-F0-9]{10}$/.test(reference)) {
    return json({ error: 'Invalid researcher or submission reference' }, 400, cors);
  }
  if (!allowedStatuses.includes(status) || message.length < 2 || message.length > 3000) {
    return json({ error: 'Choose a valid review status and add a message for the researcher' }, 400, cors);
  }

  let recordEndpoint;
  try {
    recordEndpoint = databaseEndpoint(env, `researchSubmissions/${ownerUid}/${reference}`);
  } catch {
    return json({ error: 'Firebase database URL is invalid' }, 503, cors);
  }
  recordEndpoint.searchParams.set('auth', admin.idToken);
  try {
    const currentResponse = await fetch(recordEndpoint);
    if (!currentResponse.ok) return json({ error: 'Could not verify the selected submission' }, 502, cors);
    if (!await currentResponse.json()) return json({ error: 'Submission not found' }, 404, cors);

    const updateResponse = await fetch(recordEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, adminFeedback: message, reviewedBy: admin.user.email, updatedAt: { '.sv': 'timestamp' } }),
    });
    if (!updateResponse.ok) return json({ error: 'Could not update submission status' }, 502, cors);
  } catch {
    return json({ error: 'Firebase database is unavailable' }, 502, cors);
  }

  const messageRequest = new Request(request.url.replace(/\/review$/, `/${reference}/messages`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerUid, message }),
  });
  const messageResponse = await postResearchMessage(messageRequest, env, cors, reference);
  if (!messageResponse.ok) return json({ error: 'Status updated, but the feedback message could not be added' }, 502, cors);
  return json({ ok: true, status }, 200, cors);
}

async function getRegistrationForUser(env, authenticated) {
  const endpoint = databaseEndpoint(env, `registrations/${authenticated.user.uid}`);
  endpoint.searchParams.set('auth', authenticated.idToken);
  const response = await fetch(endpoint);
  if (!response.ok) {
    const error = new Error('FIREBASE_REGISTRATION_READ_DENIED');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function getStudentAdmission(request, env, cors) {
  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated.response;

  let registration;
  try {
    registration = await getRegistrationForUser(env, authenticated);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return json({ error: 'Firebase denied access to your student registration. Realtime Database rules must allow this signed-in UID to read /registrations/{uid}.' }, 403, cors);
    }
    return json({ error: 'Could not load your student registration from Firebase' }, 502, cors);
  }
  if (!registration) return json({ error: 'No student registration found for this account. Register with this same email first.' }, 404, cors);

  let admissions = {};
  try {
    const endpoint = databaseEndpoint(env, `admissions/${authenticated.user.uid}`);
    endpoint.searchParams.set('auth', authenticated.idToken);
    const response = await fetch(endpoint);
    if (response.ok) admissions = await response.json() || {};
  } catch {
    admissions = {};
  }
  return json({ ok: true, registration, admissions }, 200, cors);
}

function validR2FileKey(key, uid) {
  return typeof key === 'string'
    && key.startsWith(`${uid}/admissions/`)
    && /^[A-Za-z0-9_-]+\/admissions\/[0-9a-f-]{36}$/i.test(key);
}

function matchesAdmissionFileSignature(bytes, contentType) {
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (contentType === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  if (contentType === 'application/pdf') return String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  return false;
}

async function handleAdmissionFile(request, env, cors, key = '') {
  if (!env.TARVIKA_R2) return json({ error: 'R2 binding TARVIKA_R2 is not configured' }, 503, cors);
  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated.response;

  if (request.method === 'POST' && !key) {
    const category = request.headers.get('X-File-Kind') || '';
    const categories = ['student-photo', 'guardian-photo', 'marksheet', 'identity-proof', 'address-proof'];
    const contentType = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    const contentLength = Number(request.headers.get('Content-Length'));
    if (!categories.includes(category)) return json({ error: 'Invalid file category' }, 400, cors);
    if (!allowedTypes.has(contentType)) return json({ error: 'Only JPG, PNG, WebP or PDF files are allowed' }, 415, cors);
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength >= 2 * 1024 * 1024) {
      return json({ error: 'Each admission file must be smaller than 2 MB' }, 413, cors);
    }
    const body = await request.arrayBuffer();
    if (body.byteLength !== contentLength || body.byteLength >= 2 * 1024 * 1024) {
      return json({ error: 'File size does not match the request or exceeds 2 MB' }, 400, cors);
    }
    if (!matchesAdmissionFileSignature(new Uint8Array(body, 0, Math.min(body.byteLength, 16)), contentType)) {
      return json({ error: 'File contents do not match the selected file type' }, 415, cors);
    }
    const id = crypto.randomUUID();
    const objectKey = `${authenticated.user.uid}/admissions/${id}`;
    const originalName = (request.headers.get('X-File-Name') || category).replace(/[\\/\r\n\0"']/g, '_').slice(0, 120);
    try {
      await env.TARVIKA_R2.put(objectKey, body, {
        httpMetadata: { contentType },
        customMetadata: { ownerUid: authenticated.user.uid, category, originalName },
      });
      return json({ ok: true, file: { key: objectKey, category, name: originalName, type: contentType, size: body.byteLength } }, 201, cors);
    } catch {
      return json({ error: 'Could not save file to private R2 storage' }, 502, cors);
    }
  }

  if (request.method === 'GET' && key && validR2FileKey(key, key.split('/')[0])) {
    const ownerUid = key.split('/')[0];
    if (ownerUid !== authenticated.user.uid) {
      const admin = await requireResearchAdmin(request, env, cors);
      if (admin.response) return admin.response;
    }
    const object = await env.TARVIKA_R2.get(key);
    if (!object || object.customMetadata?.ownerUid !== ownerUid) {
      return json({ error: 'File not found' }, 404, cors);
    }
    const headers = new Headers(cors);
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Length', String(object.size));
    headers.set('Content-Disposition', `inline; filename="${(object.customMetadata?.originalName || 'admission-file').replace(/["\r\n]/g, '_')}"`);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { headers });
  }

  return json({ error: 'Not found' }, 404, cors);
}

async function saveStudentAdmission(request, env, cors) {
  if (!env.FIREBASE_DATABASE_URL) return json({ error: 'Firebase database configuration is incomplete' }, 503, cors);
  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated.response;
  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(length) || length <= 0 || length > 24 * 1024) return json({ error: 'Admission form is too large' }, 413, cors);

  let input;
  try { input = await request.json(); } catch { return json({ error: 'Request body must be valid JSON' }, 400, cors); }
  const fields = ['dateOfBirth', 'gender', 'nationality', 'guardianName', 'guardianRelation', 'guardianPhone', 'guardianEmail', 'guardianOccupation', 'permanentAddress', 'emergencyName', 'emergencyPhone', 'program', 'qualification', 'qualificationStatus', 'institutionName', 'institutionCity'];
  const data = {};
  for (const field of fields) data[field] = typeof input[field] === 'string' ? input[field].trim() : '';
  const consent = input.consent === true;
  const allowedGenders = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Self-describe'];
  const allowedRelations = ['Father', 'Mother', 'Guardian', 'Other'];
  const allowedPrograms = ['Digital Marketing', 'AI & Machine Learning', 'Agri Tech', 'Space Technology', 'Cyber Security', 'Web Development & DevOps', 'Digital Forensics'];
  const birthDate = new Date(`${data.dateOfBirth}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dateOfBirth) || Number.isNaN(birthDate.getTime()) || birthDate.toISOString().slice(0, 10) !== data.dateOfBirth || birthDate > new Date()) return json({ error: 'Enter a valid date of birth that is not in the future' }, 400, cors);
  if (!allowedGenders.includes(data.gender) || !allowedRelations.includes(data.guardianRelation)) return json({ error: 'Select a valid gender and guardian relationship' }, 400, cors);
  if (data.nationality.length < 2 || data.nationality.length > 80 || data.guardianName.length < 2 || data.guardianName.length > 120) return json({ error: 'Enter valid nationality and parent/guardian name' }, 400, cors);
  if (!/^\+?[0-9 ()-]{7,20}$/.test(data.guardianPhone) || !/^\+?[0-9 ()-]{7,20}$/.test(data.emergencyPhone)) return json({ error: 'Enter valid guardian and emergency contact numbers' }, 400, cors);
  if (data.guardianEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guardianEmail)) return json({ error: 'Enter a valid guardian email or leave it blank' }, 400, cors);
  if (data.guardianOccupation.length > 120 || data.emergencyName.length < 2 || data.emergencyName.length > 120) return json({ error: 'Enter valid guardian occupation and emergency contact name' }, 400, cors);
  if (data.permanentAddress.length < 8 || data.permanentAddress.length > 500 || !consent) return json({ error: 'Enter a valid permanent address and confirm the declaration' }, 400, cors);
  if (!allowedPrograms.includes(data.program) || !['10th', '12th', 'UG', 'PG'].includes(data.qualification) || !['Passed', 'Pursuing'].includes(data.qualificationStatus)) return json({ error: 'Choose valid program and qualification information' }, 400, cors);

  let registration;
  try {
    registration = await getRegistrationForUser(env, authenticated);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return json({ error: 'Firebase rules blocked access to /registrations/{uid}. Allow the signed-in student to read their own registration record.' }, 403, cors);
    }
    return json({ error: 'Could not verify your student registration' }, 502, cors);
  }
  if (!registration) return json({ error: 'Complete student registration before applying for admission' }, 409, cors);
  if (registration.email !== authenticated.user.email) return json({ error: 'Your student registration account does not match this login' }, 403, cors);

  const files = Array.isArray(input.files) ? input.files : [];
  if (files.length < 1 || files.length > 5) return json({ error: 'Upload a student photo and no more than five admission documents' }, 400, cors);
  const categories = new Set();
  for (const file of files) {
    if (!file || !validR2FileKey(file.key, authenticated.user.uid) || !['student-photo', 'guardian-photo', 'marksheet', 'identity-proof', 'address-proof'].includes(file.category)) return json({ error: 'Invalid or inaccessible admission file' }, 400, cors);
    if (categories.has(file.category) && file.category === 'student-photo') return json({ error: 'Only one student photo is allowed' }, 400, cors);
    categories.add(file.category);
    const object = await env.TARVIKA_R2.get(file.key);
    if (!object || object.customMetadata?.ownerUid !== authenticated.user.uid || object.customMetadata?.category !== file.category || object.size >= 2 * 1024 * 1024) return json({ error: 'An uploaded file is missing or invalid' }, 400, cors);
  }
  if (!categories.has('student-photo')) return json({ error: 'A student photo is required' }, 400, cors);

  const reference = `TRV-ADM-${new Date().getUTCFullYear()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  let endpoint;
  try { endpoint = databaseEndpoint(env, `admissions/${authenticated.user.uid}/${reference}`); } catch { return json({ error: 'Firebase database URL is invalid' }, 503, cors); }
  endpoint.searchParams.set('auth', authenticated.idToken);
  const record = {
    reference,
    studentUid: authenticated.user.uid,
    studentName: registration.studentName,
    email: authenticated.user.email,
    mobileNumber: registration.mobileNumber,
    whatsappNumber: registration.whatsappNumber,
    address: registration.address,
    city: registration.city,
    dateOfBirth: data.dateOfBirth,
    gender: data.gender,
    nationality: data.nationality,
    guardianName: data.guardianName,
    guardianRelation: data.guardianRelation,
    guardianPhone: data.guardianPhone,
    guardianEmail: data.guardianEmail,
    guardianOccupation: data.guardianOccupation,
    permanentAddress: data.permanentAddress,
    emergencyName: data.emergencyName,
    emergencyPhone: data.emergencyPhone,
    program: data.program,
    qualification: data.qualification,
    qualificationStatus: data.qualificationStatus,
    institutionName: data.institutionName,
    institutionCity: data.institutionCity,
    files,
    status: 'submitted',
    fees: null,
    submittedAt: { '.sv': 'timestamp' },
  };
  try {
    const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
    if (!response.ok) return json({ error: 'Could not save admission application' }, 502, cors);
    return json({ ok: true, reference }, 201, cors);
  } catch { return json({ error: 'Firebase database is unavailable' }, 502, cors); }
}

async function getAdminAdmissions(request, env, cors) {
  const admin = await requireResearchAdmin(request, env, cors);
  if (admin.response) return admin.response;
  let endpoint;
  try { endpoint = databaseEndpoint(env, 'admissions'); } catch { return json({ error: 'Firebase database URL is invalid' }, 503, cors); }
  endpoint.searchParams.set('auth', admin.idToken);
  try {
    const response = await fetch(endpoint);
    if (!response.ok) return json({ error: 'Could not load admissions' }, 502, cors);
    return json({ ok: true, admissions: await response.json() || {} }, 200, cors);
  } catch { return json({ error: 'Firebase database is unavailable' }, 502, cors); }
}

async function reviewAdmission(request, env, cors) {
  const admin = await requireResearchAdmin(request, env, cors);
  if (admin.response) return admin.response;
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Request body must be valid JSON' }, 400, cors); }
  const ownerUid = typeof input.ownerUid === 'string' ? input.ownerUid : '';
  const reference = typeof input.reference === 'string' ? input.reference : '';
  const status = typeof input.status === 'string' ? input.status : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const feeInput = input.fees && typeof input.fees === 'object' ? input.fees : {};
  const statuses = ['under_review', 'documents_requested', 'approved', 'declined', 'enrolled'];
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid) || !/^TRV-ADM-[0-9]{4}-[A-F0-9]{8}$/.test(reference) || !statuses.includes(status)) return json({ error: 'Invalid admission review details' }, 400, cors);
  if (note.length > 3000) return json({ error: 'Review note must be under 3000 characters' }, 400, cors);
  if (typeof feeInput.tuition !== 'number' || !Number.isFinite(feeInput.tuition)) return json({ error: 'Enter the approved tuition amount before saving the fee review' }, 400, cors);
  const feeFields = ['tuition', 'registration', 'materials', 'other', 'discount', 'scholarship', 'paid'];
  const fees = {};
  for (const field of feeFields) {
    const value = Number(feeInput[field] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 10000000) return json({ error: 'Fee entries must be non-negative amounts up to 10,000,000' }, 400, cors);
    fees[field] = Math.round(value * 100) / 100;
  }
  fees.total = Math.round(Math.max(0, fees.tuition + fees.registration + fees.materials + fees.other - fees.discount - fees.scholarship) * 100) / 100;
  if (fees.paid > fees.total) return json({ error: 'Amount paid cannot exceed the total payable' }, 400, cors);
  fees.balance = Math.round(Math.max(0, fees.total - fees.paid) * 100) / 100;
  fees.paymentStatus = fees.balance === 0 ? 'paid' : fees.paid > 0 ? 'partially_paid' : 'unpaid';

  let endpoint;
  try { endpoint = databaseEndpoint(env, `admissions/${ownerUid}/${reference}`); } catch { return json({ error: 'Firebase database URL is invalid' }, 503, cors); }
  endpoint.searchParams.set('auth', admin.idToken);
  try {
    const existingResponse = await fetch(endpoint);
    if (!existingResponse.ok) return json({ error: 'Could not verify application record' }, 502, cors);
    if (!await existingResponse.json()) return json({ error: 'Admission application not found' }, 404, cors);
    const response = await fetch(endpoint, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewNote: note, fees, reviewedBy: admin.user.email, reviewedAt: { '.sv': 'timestamp' } }),
    });
    if (!response.ok) return json({ error: 'Could not update admission review' }, 502, cors);
    return json({ ok: true, status, fees }, 200, cors);
  } catch { return json({ error: 'Firebase database is unavailable' }, 502, cors); }
}

async function saveRegistration(request, env, cors) {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_API_KEY) {
    return json({ error: 'Firebase database configuration is incomplete' }, 503, cors);
  }

  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated.response;

  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(length) || length <= 0 || length > 24 * 1024) {
    return json({ error: 'Registration must be between 1 byte and 24 KB' }, 413, cors);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400, cors);
  }

  const studentName = typeof input.studentName === 'string' ? input.studentName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const whatsappNumber = typeof input.whatsappNumber === 'string' ? input.whatsappNumber.trim() : '';
  const mobileNumber = typeof input.mobileNumber === 'string' ? input.mobileNumber.trim() : '';
  const address = typeof input.address === 'string' ? input.address.trim() : '';
  const city = typeof input.city === 'string' ? input.city.trim() : '';
  const qualification = typeof input.qualification === 'string' ? input.qualification : '';
  const qualificationStatus = typeof input.qualificationStatus === 'string' ? input.qualificationStatus : '';
  const degree = typeof input.degree === 'string' ? input.degree : '';
  const institutionName = typeof input.institutionName === 'string' ? input.institutionName.trim() : '';
  const institutionCity = typeof input.institutionCity === 'string' ? input.institutionCity.trim() : '';
  const program = typeof input.program === 'string' ? input.program : '';
  const consent = input.consent === true;

  const degreesByQualification = {
    '10th': ['Not applicable'],
    '12th': ['Science', 'Commerce', 'Arts/Humanities', 'Vocational', 'Other'],
    UG: ['BA', 'BSc', 'BCom', 'BCA', 'BBA', 'BTech/BE', 'BPharm', 'BDes', 'LLB', 'Other'],
    PG: ['MA', 'MSc', 'MCom', 'MCA', 'MBA', 'MTech/ME', 'MPharm', 'LLM', 'Other'],
  };
  const programs = [
    'Digital Marketing',
    'AI & Machine Learning',
    'Agri Tech',
    'Space Technology',
    'Cyber Security',
    'Web Development & DevOps',
    'Digital Forensics',
  ];

  if (studentName.length < 2 || studentName.length > 100) {
    return json({ error: 'Enter a student name between 2 and 100 characters' }, 400, cors);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: 'Enter a valid email address' }, 400, cors);
  }
  if (email !== authenticated.user.email) {
    return json({ error: 'Registration email must match the signed-in account.' }, 403, cors);
  }
  if (!/^\+?[0-9 ()-]{7,20}$/.test(whatsappNumber) || !/^\+?[0-9 ()-]{7,20}$/.test(mobileNumber)) {
    return json({ error: 'Enter valid WhatsApp and mobile numbers' }, 400, cors);
  }
  if (address.length < 8 || address.length > 500 || city.length < 2 || city.length > 100) {
    return json({ error: 'Enter a valid address and city' }, 400, cors);
  }
  if (!degreesByQualification[qualification] || !['Passed', 'Pursuing'].includes(qualificationStatus)) {
    return json({ error: 'Select a valid qualification and status' }, 400, cors);
  }
  if (!degreesByQualification[qualification].includes(degree)) {
    return json({ error: 'Select a degree or stream that matches your qualification' }, 400, cors);
  }
  if (institutionName.length < 2 || institutionName.length > 160 || institutionCity.length < 2 || institutionCity.length > 100) {
    return json({ error: 'Enter your school/college name and its city' }, 400, cors);
  }
  if (!programs.includes(program) || !consent) {
    return json({ error: 'Select a program and confirm the information notice' }, 400, cors);
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(env.FIREBASE_DATABASE_URL);
    if (databaseUrl.protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    return json({ error: 'Firebase database configuration is unavailable' }, 503, cors);
  }

  const year = new Date().getUTCFullYear();
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const studentId = `TRV-${year}-${suffix}`;
  const databaseEndpoint = new URL(
    `${databaseUrl.toString().replace(/\/+$/, '')}/registrations/${authenticated.user.uid}.json`,
  );
  databaseEndpoint.searchParams.set('auth', authenticated.idToken);

  let response;
  try {
    response = await fetch(databaseEndpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        studentName,
        email,
        whatsappNumber,
        mobileNumber,
        address,
        city,
        qualification,
        qualificationStatus,
        degree,
        institutionName,
        institutionCity,
        program,
        status: 'received',
        createdAt: { '.sv': 'timestamp' },
      }),
    });
  } catch {
    return json({ error: 'Firebase database is unavailable' }, 502, cors);
  }

  if (!response.ok) return json({ error: 'Could not save registration' }, 502, cors);
  return json({ ok: true, studentId }, 201, cors);
}

async function loadRegistration(request, env, cors) {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_API_KEY) {
    return json({ error: 'Firebase database configuration is incomplete' }, 503, cors);
  }

  const authenticated = await getAuthenticatedFirebaseUser(request, env, cors);
  if (authenticated.response) return authenticated.response;

  let databaseEndpoint;
  try {
    const databaseUrl = new URL(env.FIREBASE_DATABASE_URL);
    if (databaseUrl.protocol !== 'https:') throw new Error('HTTPS required');
    databaseEndpoint = new URL(
      `${databaseUrl.toString().replace(/\/+$/, '')}/registrations/${authenticated.user.uid}.json`,
    );
  } catch {
    return json({ error: 'Firebase database URL is invalid' }, 503, cors);
  }

  databaseEndpoint.searchParams.set('auth', authenticated.idToken);
  let response;
  try {
    response = await fetch(databaseEndpoint);
  } catch {
    return json({ error: 'Firebase database is unavailable' }, 502, cors);
  }

  if (!response.ok) return json({ error: 'Could not load your registration' }, 502, cors);
  const registration = await response.json();
  if (!registration) return json({ error: 'No registration found for this account' }, 404, cors);
  return json({ ok: true, registration }, 200, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (cors === null) return json({ error: 'Origin not allowed' }, 403);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'GET' && path === '/') {
      return json({ service: 'TARVIKA API', status: 'ok' }, 200, cors);
    }

    if (request.method === 'POST' && path === '/api/enquiries') {
      return saveEnquiry(request, env, cors);
    }

    if (request.method === 'POST' && path === '/api/employee-applications') {
      return saveEmployeeApplication(request, env, cors);
    }

    if (request.method === 'POST' && path === '/api/research-submissions') {
      return saveResearchSubmission(request, env, cors);
    }

    if (request.method === 'GET' && path === '/api/admissions/me') {
      return getStudentAdmission(request, env, cors);
    }

    if (request.method === 'POST' && path === '/api/admissions') {
      return saveStudentAdmission(request, env, cors);
    }

    if (request.method === 'POST' && path === '/api/admissions/files') {
      return handleAdmissionFile(request, env, cors);
    }

    const admissionFileMatch = path.match(/^\/api\/admissions\/files\/(.+)$/);
    if (request.method === 'GET' && admissionFileMatch) {
      return handleAdmissionFile(request, env, cors, decodeURIComponent(admissionFileMatch[1]));
    }

    if (request.method === 'GET' && path === '/api/admin/admissions') {
      return getAdminAdmissions(request, env, cors);
    }

    if (request.method === 'POST' && path === '/api/admin/admissions/review') {
      return reviewAdmission(request, env, cors);
    }

    if (request.method === 'GET' && path === '/api/research-submissions/mine') {
      return getResearcherSubmissions(request, env, cors);
    }

    const researcherMessageMatch = path.match(/^\/api\/research-submissions\/(TRR-[0-9]{4}-[A-F0-9]{10})\/messages$/);
    if (request.method === 'POST' && researcherMessageMatch) {
      return postResearchMessage(request, env, cors, researcherMessageMatch[1]);
    }

    if (request.method === 'GET' && path === '/api/admin/research-submissions') {
      return getAdminResearchSubmissions(request, env, cors);
    }

    if (request.method === 'POST' && path === '/api/admin/research-submissions/review') {
      return reviewResearchSubmission(request, env, cors);
    }

    if (request.method === 'POST' && path === '/api/auth/register') {
      return handleAccountAuth(request, env, cors, 'register');
    }

    if (request.method === 'POST' && path === '/api/auth/login') {
      return handleAccountAuth(request, env, cors, 'login');
    }

    if (request.method === 'POST' && path === '/api/registrations') {
      return saveRegistration(request, env, cors);
    }

    if (request.method === 'GET' && path === '/api/registrations/me') {
      return loadRegistration(request, env, cors);
    }

    if (path === '/api/files' || path.startsWith('/api/files/')) {
      return json({ error: 'File API is not enabled yet' }, 503, cors);
    }

    if (!path.startsWith('/api/files')) {
      return json({ error: 'Not found' }, 404, cors);
    }
    return json({ error: 'Not found' }, 404, cors);
  },
};