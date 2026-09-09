# Fulfillment readiness contract v1

After a customer selects a proof, FAMtastic remains the authority for the
customer, selection, and payment. Site Studio Next may accept a packet only
when the source snapshot is account-bound, the selected proof is current, and
the payment event is verified as `paid`.

The readiness coordinator then produces a packet, build brief, artifact
manifest hash, configurable Git target, and explicit gates. It does not send
email, charge, push Git, upload cPanel, change DNS, or mutate a customer
record. A result of `ready_for_local_build` means the local build can be
tested; it is not a staging or production claim. External readiness requires a
configured remote, credential preflight, an injected FAMtastic Inc transport,
and a receipt from that transport.

The normal path is therefore:

```text
verified payment -> selected packet -> local build + parity -> Git commit
-> explicit remote push receipt -> FAMtastic Inc staging receipt -> owner QA
-> production receipt -> post-payment DNS authorization
```

The deployment provider, hosting class, repository mode, branch, remote URL,
and per-site subdirectory are configurable. The default is FAMtastic Inc
shared hosting with a site-specific subdirectory; the shared hosting root is
never a valid target.
