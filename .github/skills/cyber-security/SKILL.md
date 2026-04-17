---
name: cyber-security
description: "Use when: Security vulnerabilities discovered, dependency updates needed, production deployment, security audit required, before releasing new API endpoints, CORS misconfiguration, exposed secrets, RLS bypass concerns, XSS risks in user input, rate limiting bypass attempts"
---

# 🔒 Cyber Security Skill

## When to Use This Skill

Activate this skill when:
- **Vulnerabilities discovered** in dependencies or code
- **Deploying to production** (mandatory pre-deploy checklist)
- **Adding new API endpoints** that handle user data
- **Security audit** is required or scheduled
- **CORS issues** or API access control concerns
- **User input handling** changes (potential XSS/injection risks)
- **Secrets/keys** exposed or leaked
- **Rate limiting** bypass attempts detected
- **RLS policy** changes in Supabase
- **Third-party integrations** added (Google Maps, Supabase, etc.)

---

## 📋 Mandatory Security Checklist

### Phase 1: Dependency & Infrastructure Audit

**Entry Point**: `npm audit` + Review `package.json`
```bash
# Check for vulnerabilities
npm audit
npm outdated

# Verify production dependencies only
npm ls --depth=0 --prod
```

**Verification**:
- [ ] All critical/high vulnerabilities resolved or justified in comments
- [ ] Dependencies pinned to stable versions (avoid `^` for security-sensitive packages)
- [ ] No dev dependencies in production build
- [ ] Supabase client version matches requirement (`@supabase/supabase-js >= 2.38.4`)
- [ ] Helmet.js installed and version checked

**Action if Failed**:
- Run `npm audit fix` to auto-patch
- Pin vulnerable versions explicitly with reason in code comment
- Update `package.json` and commit

---

### Phase 2: Backend Security Headers & Configuration

**Entry Point**: `server.js` middleware section

**Helmet.js Configuration** (must be applied FIRST before CORS):
```javascript
// ✅ CORRECT ORDER in server.js:
app.use(helmet());              // Security headers FIRST
app.use(cors(corsOptions));     // CORS policies SECOND
app.use(express.json());        // Body parsing THIRD
```

**Verification Checklist**:
- [ ] Helmet.js enabled with default settings (or justified custom config)
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (for HTTPS)
  - `Content-Security-Policy` headers set

- [ ] CORS properly configured:
  - `allowedOrigins` matches deployed frontend URL (Vercel domain)
  - No wildcard `*` in production (only dev)
  - Credentials mode set correctly: `credentials: 'include'` when needed

- [ ] Rate limiting implemented:
  ```javascript
  const rateLimit = require('express-rate-limit');
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,    // 15 minutes
    max: 100,                      // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
  });
  app.use('/api/', limiter);     // Apply to all API routes
  ```

- [ ] Request timeout enforced:
  - [ ] `REQUEST_TIMEOUT_MS` configured in `.env`
  - [ ] Timeout applied to external API calls (Google Maps)
  - [ ] Default: 12000ms (12 seconds)

**Action if Failed**:
- Add missing middleware
- Test with browser DevTools (F12 > Network > Response Headers)
- Verify headers present: `curl -I http://localhost:8000/api/health`

---

### Phase 3: Input Validation & Sanitization

**Entry Point**: All POST/PUT endpoints in `server.js`

**Validation Requirements**:

For each endpoint, verify:
- [ ] Required fields validated (non-empty, correct type)
- [ ] String inputs trimmed: `.trim()`
- [ ] SQL injection prevention via parameterized queries (Supabase SDK handles this)
- [ ] Email/phone validation if applicable
- [ ] Numeric inputs parsed safely: `parseInt(..., 10)` with fallback
- [ ] Length limits enforced on text fields

**Example Patterns** (already in code, verify presence):
```javascript
// ✅ GOOD: Validation + sanitization
if (!nome || !sigla) {
  return res.status(400).json({ error: 'Nome e sigla são obrigatórios' });
}
const siglaUp = sigla.toUpperCase().trim();

// ❌ BAD: Missing validation
const result = await supabase.from('table').insert(req.body);
```

**Sanitization Functions** (verify in `server.js`):
- [ ] `normalizePhone()` - removes non-digits
- [ ] `normalizeCustomerName()` - removes special chars, normalizes Unicode
- [ ] `parseMatrixLocations()` - validates location string format
- [ ] All user inputs passed through sanitization before DB operations

**Action if Failed**:
- Add validation function for each endpoint parameter
- Use `express-validator` if complex rules needed:
  ```javascript
  const { body, validationResult } = require('express-validator');
  app.post('/api/service-types', 
    body('nome').trim().notEmpty(),
    body('sigla').trim().notEmpty().isLength({ max: 20 }),
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      // ... proceed
    }
  );
  ```

---

### Phase 4: API Contract & Error Handling

**Entry Point**: Response objects + error handlers

**Verification**:
- [ ] **No stack traces in production responses** - errors logged server-side only
  ```javascript
  // ✅ GOOD
  catch (error) {
    console.error('Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
  // ❌ BAD
  catch (error) {
    res.status(500).json({ error: error.stack }); // Leaks internals!
  }
  ```

- [ ] **HTTP status codes correct**:
  - 400: Bad request (validation failed)
  - 401: Unauthorized (auth required)
  - 403: Forbidden (auth OK, but access denied)
  - 404: Not found
  - 409: Conflict (duplicate unique constraint)
  - 503: Service unavailable (Google Maps API down)
  - 504: Gateway timeout (request exceeded timeout)

- [ ] **Sensitive data not logged or exposed**:
  - No API keys in logs
  - No passwords/tokens in responses
  - No SQL queries with raw input visible

- [ ] **Error messages are user-friendly** (don't leak DB schema):
  ```javascript
  // ✅ GOOD
  return res.status(409).json({ error: 'Já existe um tipo com este nome ou sigla' });
  
  // ❌ BAD
  return res.status(500).json({ error: 'Duplicate key violation in table service_types column sigla' });
  ```

**Action if Failed**:
- Review all error handlers in routes
- Sanitize error messages in `src/error-handler.js` if exists
- Test with invalid inputs and verify safe error responses

---

### Phase 5: Frontend XSS Protection

**Entry Point**: `frontend/index.html` JavaScript code

**Critical Checks**:
- [ ] **No `innerHTML` with user data**:
  ```javascript
  // ❌ DANGEROUS
  document.getElementById('user-list').innerHTML = userInput;
  
  // ✅ SAFE: Use textContent or DOM creation
  const div = document.createElement('div');
  div.textContent = userInput;  // Automatically escaped
  ```

- [ ] **All form inputs sanitized before display**:
  - User-entered names in lists: `.textContent` not `.innerHTML`
  - Phone numbers: already sanitized by `normalizePhone()`
  - Addresses: displayed as text, not HTML

- [ ] **localStorage usage secure**:
  - No sensitive tokens stored in localStorage (use HttpOnly cookies if possible)
  - API keys hardcoded in frontend: ✅ OK if public/restricted (Google Maps public key)
  - Supabase anon key: ✅ OK if RLS enforces access control

- [ ] **External links validated**:
  - Links from API responses validated before `href` assignment
  - No `javascript:` or `data:` schemes in dynamic links

**Example Safe Pattern** (verify in `frontend/index.html`):
```javascript
// ✅ GOOD: Render user data safely
function renderRotas(rotas) {
  rotas.forEach(rota => {
    const card = document.createElement('div');
    card.className = 'rota-card';
    card.textContent = rota.nome;  // Safe: text content only
    container.appendChild(card);
  });
}

// Existing: validarRotas() with API status checks - ✅ GOOD
```

**Action if Failed**:
- Audit JavaScript for `innerHTML` with dynamic data
- Replace with `.textContent` or DOM methods
- Test with special characters: `<script>alert('xss')</script>` as input

---

### Phase 6: Supabase RLS & Access Control

**Entry Point**: Supabase Dashboard > Authentication > Policies

**Verification**:
- [ ] **RLS Enabled** on all sensitive tables:
  - [ ] `service_types` - RLS enabled (currently read-only frontend)
  - [ ] `services` - RLS enabled
  - [ ] `customers` - RLS enabled
  - [ ] `technicians` - RLS enabled

- [ ] **Current RLS Policy** (verify in dashboard):
  ```sql
  -- For development/testing (permissive):
  CREATE POLICY "All users can read"
  ON service_types FOR SELECT USING (TRUE);
  
  -- For production (restrictive):
  CREATE POLICY "Service role can all, anon can read"
  ON service_types FOR SELECT USING (TRUE)  -- Anon read-only
  ```

- [ ] **Backend API is source of truth**:
  - [ ] Frontend never INSERT/UPDATE/DELETE directly on `service_types`
  - [ ] All writes go through `/api/service-types` endpoint
  - [ ] Backend uses `SUPABASE_SERVICE_ROLE_KEY` for full access

- [ ] **Environment variables correct**:
  - [ ] `.env.local` (dev): `SUPABASE_ANON_KEY` for frontend
  - [ ] `.env` (Render): `SUPABASE_SERVICE_ROLE_KEY` for backend API
  - [ ] Never mix: anon key in backend or service key in frontend

**SQL Diagnostic Query**:
```sql
-- Check RLS status on all tables
SELECT schemaname, tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Check active policies
SELECT * FROM pg_policies WHERE schemaname = 'public';
```

**Action if Failed**:
- Enable RLS on unprotected tables in Supabase dashboard
- Update RLS policies for production if permissive
- Rotate `SUPABASE_SERVICE_ROLE_KEY` if exposed
- Re-deploy backend with correct env vars

---

### Phase 7: Environment Variables & Secrets

**Entry Point**: `.env`, `render.yaml`, Vercel project settings

**Verification Checklist**:
- [ ] `.env` exists locally and is in `.gitignore` (never commit secrets)
- [ ] `.env` contains all required variables:
  ```
  SUPABASE_URL=https://xxxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJxxxx (NEVER share or commit)
  SUPABASE_ANON_KEY=eyJxxxx (OK to commit if public key)
  GOOGLE_MAPS_API_KEY=AIzaxxxxx (Restricted to domains, OK to commit)
  ALLOWED_ORIGINS=https://yourfrontend.vercel.app,http://localhost:3000
  REQUEST_TIMEOUT_MS=12000
  PORT=8000
  ```

- [ ] **Secrets in Render dashboard** (not in `render.yaml`):
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` set as secret env var
  - [ ] `SUPABASE_ANON_KEY` set (if needed)
  - [ ] `GOOGLE_MAPS_API_KEY` set (if backend needs it)

- [ ] **Vercel secrets** (for frontend if needed):
  - [ ] No sensitive keys in Vercel (frontend is public)
  - [ ] `NEXT_PUBLIC_*` only for non-secret vars

- [ ] **No secrets in code**:
  - Grep for hardcoded keys:
    ```bash
    grep -r "sk_" src/ || echo "No Stripe keys found"
    grep -r "AIza" src/ || echo "Only public Google key OK"
    grep -r "eyJ" .env || echo "Check JWT tokens"
    ```

**Action if Failed**:
- Add missing vars to `.env` and Render dashboard
- Rotate exposed secrets immediately
- Update `.gitignore`: ensure `.env` never committed

---

### Phase 8: Deployment & Monitoring

**Pre-Deployment Checklist**:
- [ ] All above phases passed locally
- [ ] `npm audit` shows 0 vulnerabilities (or justified exceptions)
- [ ] **Staging deployment test**:
  ```bash
  # Test API security headers
  curl -I https://backend-staging.onrender.com/api/health
  
  # Verify CORS
  curl -H "Origin: http://localhost:3000" https://backend-staging.onrender.com/api/health
  
  # Test rate limiting (send 150 requests quickly)
  for i in {1..150}; do curl https://backend-staging.onrender.com/api/health; done
  ```

- [ ] **Smoke tests on production**:
  - [ ] Health endpoint returns 200
  - [ ] Create customer endpoint validates inputs
  - [ ] Rate limiting active (verify 429 after threshold)
  - [ ] Error responses don't leak internals

- [ ] **Monitoring configured**:
  - [ ] Render logs checked for errors
  - [ ] Response times < 2s average (alert if > 5s)
  - [ ] Error rate < 1% (alert if > 5%)

**Action if Failed**:
- Fix issues in staging first
- Do not deploy to production if checks fail
- Notify team of blockers

---

## 🔧 Quick Diagnostic Commands

```bash
# Check security headers (local dev)
curl -i http://localhost:8000/api/health

# Verify CORS headers
curl -H "Origin: https://yourfrontend.vercel.app" \
     -H "Access-Control-Request-Method: POST" \
     http://localhost:8000/api/service-types

# Test rate limiting
for i in {1..5}; do curl http://localhost:8000/api/health; sleep 0.1; done

# Check for vulnerable dependencies
npm audit --json | jq '.metadata.vulnerabilities'

# Verify no secrets in git history
git log --patch --all -S 'SUPABASE_SERVICE_ROLE' -- ':(exclude).env'

# Check for common XSS patterns in frontend
grep -n "innerHTML" frontend/index.html | grep -v "textContent\|createElement"
```

---

## 📚 Security Best Practices Reference

### OWASP Top 10 (Relevant to this Stack)

1. **Injection** → Use Supabase parameterized queries (already done)
2. **Broken Authentication** → RLS policies + backend validation ✓
3. **Sensitive Data Exposure** → Helmet.js + HTTPS + No stack traces ✓
4. **XML External Entities (XXE)** → N/A (JSON API)
5. **Broken Access Control** → RLS + CORS + Input validation ✓
6. **Security Misconfiguration** → This checklist ✓
7. **XSS** → Frontend sanitization (textContent, no innerHTML) ✓
8. **Insecure Deserialization** → Validate req.body schemas
9. **Using Components with Known Vulnerabilities** → `npm audit` ✓
10. **Insufficient Logging & Monitoring** → Check Render logs ✓

### Rate Limiting Strategy
- **Per-endpoint**: Critical writes (POST, PUT, DELETE) 10 req/min per IP
- **Global**: 100 req/min per IP to all endpoints
- **Burst**: Allow 3x normal for valid users (whitelist if needed)

### Secrets Rotation Schedule
- **SUPABASE_SERVICE_ROLE_KEY**: Every 6 months or if exposed
- **GOOGLE_MAPS_API_KEY**: Monitor usage, rotate if quota exceeded or suspicious activity
- **Database credentials**: Via Supabase, rotate if compromised

---

## ✅ Exit Criteria

Deploy to production **only if ALL** of the following are true:

- [ ] All mandatory checklist items (Phases 1-8) completed
- [ ] `npm audit` shows 0 critical/high vulnerabilities
- [ ] Staging deployment passes all smoke tests
- [ ] No error responses leak internal details
- [ ] CORS, rate limiting, and security headers active
- [ ] RLS policies enforced in Supabase
- [ ] Environment variables correctly set in Render/Vercel
- [ ] Frontend XSS checks passed (no innerHTML with user data)
- [ ] Team review completed (code + security checklist)

---

## 🎯 Workflow Integration

1. **Before every deploy**: Run this checklist (takes ~15 min)
2. **On dependency updates**: Run Phase 1 (`npm audit`)
3. **On new API endpoints**: Run Phase 3 + 4 (input validation)
4. **Monthly audit**: Run entire checklist as preventive measure
5. **On security incidents**: Run all phases + investigation

---

## 📖 Additional Resources

- [OWASP Top 10](https://owasp.org/Top10/)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Supabase RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Express Rate Limiting](https://github.com/nfriedly/express-rate-limit)

