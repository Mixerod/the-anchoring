---
title: Identity, authorisation, and the input you did not validate
residency: index
tags: [security, authentication, authorization, oauth, jwt, secrets, mtls]
when:
  - authentication or authorization is being designed or changed
  - a credential must be stored, rotated, or distributed
  - user input reaches a query, a template, a path, or an outbound request
  - a service must prove its identity to another service
  - a token must be revoked before it expires
  - deciding what a compromised component could reach
  - data must be encrypted at rest or in transit
---

# Identity, authorisation, and the input you did not validate

Two questions, always separate: **who are you** (authentication) and **what may you do**
(authorization). Conflating them is how "logged in" becomes "allowed", which is the most
common serious access-control bug there is.

## Authentication

**Do not build it.** Password hashing, reset flows, session fixation, timing attacks, MFA,
account recovery — each is a well-known way to get it wrong. Use an identity provider, or a
maintained library, and spend the effort on authorization, which is domain-specific and which
nobody can do for you.

**OAuth 2.0 is authorization delegation. OIDC is authentication.** They are constantly confused.
OAuth gets you an access token to call an API on a user's behalf; OIDC adds an ID token that
says who the user is. If you want "log in with X", you want OIDC.

**Authorization Code with PKCE is the flow**, for web and mobile and single-page apps alike. The
implicit flow is deprecated. Passwords never pass through your application.

## Tokens

**A JWT is signed, not encrypted.** Anyone holding it can read the payload. Never put anything
in a JWT you would not print in a log.

**Verify properly**, every time:
- Check the signature with a key you fetched from a trusted source.
- **Pin the expected algorithm.** Accepting the token's own `alg` header allows `none` and
  allows an RS256 public key to be used as an HS256 secret. Both are classic full bypasses.
- Check `iss`, `aud`, and `exp`. A token minted for another service is a valid token.

**The revocation problem is the reason to keep them short.** A stateless token is valid until it
expires; there is no list to remove it from. Access tokens live minutes, refresh tokens live
longer and *are* stored server-side so they can be revoked. If you find yourself building a
denylist of unexpired access tokens, you have rebuilt sessions with extra steps — and sessions
are a perfectly good answer for a first-party web application.

**Rotate signing keys**, publish more than one, and honour a key ID in the header, so rotation
does not invalidate every live token at once.

## Authorization

- **RBAC** — permissions attach to roles, users get roles. Simple, auditable, and it does not
  express "the owner of *this* document". Reach for it first.
- **ABAC / policy engine** — decisions from attributes of user, resource, and context. Reach for
  it when ownership, tenancy, or time genuinely determine access. Costs a policy language and a
  new place for bugs to hide.

**Check authorization at the resource, not at the route.** `GET /orders/123` authenticated as
user B must verify that order 123 belongs to B. A route-level check that the user is logged in
is the shape of every "insecure direct object reference" ever reported — and it is invisible in
testing, because your test user owns their own data.

**Deny by default.** A new endpoint with no rule must be inaccessible, not public. This is a
framework configuration decision, and it is worth verifying rather than assuming.

**Least privilege, applied to services as well as people.** Each service gets its own identity
and only the permissions it uses. The test is: *if this component were fully compromised, what
could it reach?* Then reduce that. A worker that reads one queue and writes one table should
not hold database-wide credentials.

## Secrets

**Never in source, never in a config file a repository could reach, never in an image layer,
never in a URL, never in a log.** Private repositories count — history is permanent, and
visibility is one setting away.

- **Store in a manager or a keyring**, and reference from configuration rather than embedding.
- **Rotate on a schedule**, and — critically — **have rotation working before you need it**.
  A secret that cannot be rotated without downtime will not be rotated during an incident,
  which is exactly when it must be.
- **Prefer short-lived, workload-issued credentials** to long-lived static ones. Cloud workload
  identity removes the stored secret entirely, which is the only fully reliable way not to leak
  one.
- **Scan before every commit, and in CI.** Match on structured token formats rather than on
  words like `password`; a scanner with a high false-positive rate is a scanner people learn to
  ignore.
- **A secret that has been in plaintext is compromised.** Rotate it. "Probably nobody saw it"
  is not a security control.

## Transport and storage

- **TLS everywhere, including inside the network.** The flat trusted network is not a model that
  survives one compromised host.
- **mTLS** when both ends must prove identity — service to service. A service mesh gives this
  without per-service code; see `traffic-management.md`.
- **Certificate expiry is a scheduled outage.** Automate renewal, and alert at 30 days
  remaining, not at 1.
- **Encryption at rest** protects against stolen disks and misconfigured storage. It does *not*
  protect against a compromised application, which has the decrypted view. Know which threat you
  are addressing.
- **Manage keys in a KMS**, with rotation and an audit trail. A key stored next to the data it
  encrypts is obfuscation.

## Input, output, and injection

Every injection is the same bug: **data was interpreted as instructions.** The fix is always
the same shape — keep them in separate channels.

- **SQL injection** — parameterised queries. Not escaping, not a library that concatenates
  "safely". If the query text is built from input, it is vulnerable.
- **Command injection** — pass an argument array to the process, never a shell string.
- **XSS** — encode on output, for the context (HTML body, attribute, JavaScript, URL — each
  differs). A modern template engine does this; string concatenation into HTML does not. Add a
  Content Security Policy as the second layer.
- **Path traversal** — resolve the path and verify it is inside the permitted root. Never
  concatenate user input into a filesystem path.
- **SSRF** — the one people forget. If the server fetches a user-supplied URL, an attacker can
  reach your internal network and your cloud metadata endpoint. Allowlist destinations, resolve
  the hostname and reject private ranges, disable redirects, and block the metadata address
  explicitly.
- **Deserialisation** — never deserialise untrusted data into arbitrary types. This is remote
  code execution in most languages that offer it.

**Validate at the boundary, with a schema, allowlisting what is permitted.** Denylisting what is
forbidden loses to an encoding you did not think of.

## Web specifics

- **CSRF** — SameSite cookies plus a token for state-changing requests. Not needed for a pure
  token-in-header API, which is one honest reason to prefer one.
- **CORS is not access control.** It restricts what a *browser* lets a page read. It
  authenticates nothing. See `api-communication.md`.
- **CSP** — a real second layer against XSS. Start in report-only mode and tighten.
- **Rate limit authentication endpoints specifically**, per account and per IP. Credential
  stuffing is the most common attack you will actually receive. See `traffic-management.md`.

## Boundaries and blast radius

- **Segment the network.** A database that only accepts connections from the application subnet
  survives a compromise of anything else.
- **Default-deny between services.** In Kubernetes the default is allow-all until a
  NetworkPolicy exists; see `containers-kubernetes.md`.
- **Zero trust, stated plainly**: location on the network grants nothing. Every request is
  authenticated and authorised regardless of where it came from.

## Error messages and logs

**An error message tells the user what to do, and tells the attacker nothing.** "Invalid
username or password" rather than "no such user", or you have built an account enumeration
endpoint. Stack traces to logs, never to responses.

**Logs are a data store with weak access control.** No passwords, no tokens, no card numbers, no
personal data beyond what is needed. This is where the majority of accidental exposure actually
happens, and it is invisible until an audit.
