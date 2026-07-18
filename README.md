# vibe-ai-chat

Google Gemini 기반 **AI 채팅 웹앱**. Next.js App Router와 Vercel AI SDK로 실시간 스트리밍 대화를 구현했습니다.

🔗 **Live demo:** https://vibe-chick.vercel.app

## 기술 스택

- **Next.js 16** (App Router) · **React 19** · **TypeScript**
- **Vercel AI SDK** (`ai`, `@ai-sdk/react`, `@ai-sdk/google`, `@openrouter/ai-sdk-provider`)
- **Google Gemini** (`gemini-2.5-flash-lite`)
- **Tailwind CSS 4**

## 주요 기능

- 토큰 단위 **실시간 스트리밍** 응답
- 모델 호출은 서버 라우트(`app/api/chat/route.ts`)에서 처리 — API 키는 환경변수로만 관리 (클라이언트 미노출)
- 간결한 단일 페이지 채팅 UI (`app/page.tsx`)

## 로컬 실행

```bash
npm install

# .env.local 에 API 키 설정
# GOOGLE_GENERATIVE_AI_API_KEY=...

npm run dev
```

http://localhost:3000 접속.

## 배포

Vercel에 연결해 배포합니다. 환경변수(`GOOGLE_GENERATIVE_AI_API_KEY`)를 프로젝트 설정에 등록하면 됩니다.
