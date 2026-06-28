## Test execution

When running tests, always use the `run_tests` tool instead of `bash`.
Do not use bash to run test commands (npm test, vitest, jest, dotnet test, go test, pytest).
If `run_tests` returns a fallback message suggesting bash, then use bash with the exact command it provides.
