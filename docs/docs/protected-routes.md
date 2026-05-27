---
sidebar_position: 4
---

# Protected routes

The pattern is the same one any SaaS uses, slimmed to the essentials:

```
Route loader  →  fetch /api/session  →  { unlocked }  →  render or throw redirect
```

## Stub gate

`worker/src/routes/session.ts` reads a single cookie (`demo_unlock`). That's the
stub. Both `/api/demo/unlock` and `/api/checkout/success` set it.

## Replacing it with real auth

Swap the cookie read for your auth library's session lookup. For Better Auth:

````ts
import { createAuth } from "../auth";

session.get("/", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return c.json({ unlocked: Boolean(session) });
});
````

For a real production gate, also check D1 for an active subscription row:

````ts
const sub = await db.query.subscriptions.findFirst({
  where: (s, { and, eq }) =>
    and(eq(s.customerEmail, session.user.email), eq(s.status, "active")),
});
return c.json({ unlocked: Boolean(sub) });
````
