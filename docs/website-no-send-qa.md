# Website no-send QA inventory

Scope: changes to the no-send mode notice, button label, response text, mode isolation, and queued test receipt. Existing report-generation and sales CTAs are not changed by this patch.

- Configured test: at desktop and 375px mobile, the results form clearly says Kenny-only, no email/contact/subscription/alert changes, and no later send from this test.
- Required permission: the snapshot checkbox stays separate from optional marketing and is not preselected.
- Valid submission: using normal form controls displays “Request recorded” and the no-send acknowledgement with a copyable snapshot link.
- Wrong recipient: shows a readable error and does not hide the form or invoke capture.
- Missing configuration: backend rejects before storing receipt; button stays disabled on config load.
- Cross-mode receipt: old test receipts cannot invoke the new capture; old sync and old capture callbacks remain unused.
- Narrow screens: no horizontal overflow; notices, checkbox labels and blue button remain legible.
- Source/backend boundary: the visual fixture performs no real research and no external API calls. Node/SQL tests separately cover genuine route and worker controls.

Screenshots and test results are saved with the preparation package. No production deployment is part of QA.
