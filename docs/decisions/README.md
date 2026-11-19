# Decision contracts

현재 결정만 보관합니다. 변경하려는 주제와 맞닿은 계약만 읽습니다.

- [ui-composition](ui-composition.md) — Read when choosing UI components, page composition, visual tokens, or custom interface boundaries.
- [deployment-ownership](deployment-ownership.md) — Read when deciding where user-built systems are stored, deployed, or whose accounts the agent acts on.
- [llm-usage-billing](llm-usage-billing.md) — Read when deciding who pays for or supplies the LLM API key (currently Azure OpenAI) the agent uses.
- [credential-storage](credential-storage.md) — Read when deciding where the user's connected credentials (LLM API key, GitHub OAuth access, Vercel token, Supabase token) are kept or whether the server may store them.
- [server-data-storage](server-data-storage.md) — Read when deciding where the data of agent-built systems is stored on a server, which database or account it uses, or who can read it.
- [dependency-versions](dependency-versions.md) — Read when upgrading dependencies, pinning versions, or wondering why TypeScript stays on 6.x.
