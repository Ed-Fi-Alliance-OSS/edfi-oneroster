# Authentication and Authorization in Ed-Fi OneRoster API

## Authentication (JWT from the Ed-FI API/API)

Authentication is delegated entirely to the Ed-FI API/API. A client first performs
the OAuth 2.0 client-credentials flow against the ODS/API and receives a **JSON Web
Token (JWT)**. The client then presents that JWT as a `Bearer` token on every request
to the Ed-Fi OneRoster API. The OneRoster API acts purely as a resource server and
verifies the token; it never mints tokens.

Token verification behavior:

- The token SHALL be an RS256-signed JWT.
- Signature is verified against a configured **PEM public key**
  (`OAUTH2_PUBLIC_KEY_PEM`), which must match the ODS/API's
  `Security:Jwt:SigningKey:PublicKey`. This shared signing key is what ties the
  two services together.
- The `aud` (audience) claim SHALL match `OAUTH2_AUDIENCE`.
- The `iss` (issuer) claim SHALL match `OAUTH2_ISSUERBASEURL` (compared after
  trailing-slash normalization).
- Expired or otherwise invalid tokens are rejected with `401` and a OneRoster error
  body.

The JWT is expected to carry the following claims (in addition to standard
`iss`, `aud`, `exp`):

| Claim                     | Type                                  | Purpose in this application                                                                                 |
| ------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scope`                   | space-delimited string (or array)     | OneRoster scope(s) granted — drives per-endpoint authorization (see 6.5).                                   |
| `educationOrganizationId` | string or array                       | The education organization(s) the token is authorized for; used to filter returned rows to authorized orgs. |
| `odsInstanceId`\*         | numeric                               | Identifies which ODS database/instance the token is authorized to query.                                    |
| `odsInstances`            | JSON string containing `OdsInstances` | Set of ODS instances the token may access; used for context-based ODS-instance resolution.                  |
| `tenantId`                | string                                | In multi-tenant deployments, the tenant the token belongs to; must match the tenant in the request route.   |

> [!TIP]
> \* The claim `odsInstanceId` can be aliased as `ods_instance_id`, `OdsInstanceId`

This JWT shape is inferred from the resource-server code and SHOULD be confirmed
against the actual token issued by the target Ed-FI API/API version (see Open
Questions).

## Authorization scheme

Authorization has two layers, both enforced in middleware after token verification:

1. **Scope-based endpoint authorization.** Each route is guarded by a scope check
   using OneRoster 1.2 scopes:
   - `.../scope/roster.readonly` (full roster read) **or**
     `.../scope/roster-core.readonly` (core roster read) grants access to all
     non-demographic endpoints.
   - `.../scope/roster-demographics.readonly` is **required** for the `demographics`
     endpoints and is the **only** scope that grants demographics access — consistent
     with OneRoster 1.2 (roster.readonly explicitly excludes demographics).
   - A request lacking the required scope receives `403` with a OneRoster error body.

2. **Education-organization row authorization.** The `educationOrganizationId`
   claim(s) are extracted from the token and used to constrain results to the
   authorized organizations. Row filtering is implemented against Ed-Fi authorization
   views in the `auth` schema (e.g.,
   `educationorganizationidtoeducationorganizationid`,
   `...tostudentusi`, `...tostaffusi`, `...tocontactusi`/`...toparentusi`), so a
   token only ever returns data for organizations (and the students/staff/contacts
   beneath them) that it is entitled to.

Additionally, in multi-tenant deployments the token's `tenantId` is validated
against the request route. When ODS-context routing is enabled, the API resolves
the ODS instance by matching the route context to an authorized entry in the JWT's
`odsInstances` claim; without context routing, the API uses the direct
`odsInstanceId` claim or falls back to the first JWT-authorized ODS instance.
