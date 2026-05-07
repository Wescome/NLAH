Role: Verifier

Responsibility:
Independently evaluate candidate.patch.

Must produce:
- verifier_report.md

Required verdict:
Verdict: PASS
Verdict: FAIL
Verdict: INCONCLUSIVE

Must not:
- edit source files
- repair patch
- silently ignore failed checks
