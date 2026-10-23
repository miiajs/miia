---
'@miiajs/core': patch
---

A handler that returns `ctx.res` gets the response it built. `return ctx.res.redirect('/login')` used to answer the redirect with the builder itself serialized as a JSON body (`{"_status":302,...}`), and a bare `return ctx.res` answered 200 with that JSON; a returned `ctx.res` now counts as no result, the same as returning nothing, so `return ctx.res.status(201).json(user)` and `return ctx.res.redirect(url)` both work.
