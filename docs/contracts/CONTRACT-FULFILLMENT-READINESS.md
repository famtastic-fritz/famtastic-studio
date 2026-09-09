# Fulfillment readiness contract v2

After a customer accepts a proof, FAMtastic remains the authority for the
customer and selection. Site Studio Next first locks that selection into a
standalone site repository and FAMtastic Inc staging target. Payment is the
promotion gate from reviewed staging into production fulfillment; it is not a
prerequisite for creating the staging artifact.

The post-payment readiness coordinator may accept a production packet only
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
proof selected -> lock-in packet -> local build + parity -> per-site Git repo
-> FAMtastic Inc staging subdirectory/subdomain -> customer/owner QA
-> verified payment -> paid fulfillment packet -> production receipt
-> domain/DNS/SSL/email cutover
```

The locked staging packet and the paid fulfillment packet are separate
evidence records. A staging receipt never implies payment, and a payment
receipt never implies that staging or production succeeded.

The deployment provider, hosting class, repository mode, branch, remote URL,
and per-site subdirectory are configurable. The default is FAMtastic Inc
shared hosting with a site-specific subdirectory; the shared hosting root is
never a valid target.
