// firebase-config.js
// Firebase 콘솔 → 프로젝트 설정(⚙️) → "내 앱" → 웹 앱(</>)의 firebaseConfig를
// 아래에 그대로 붙여넣으세요. (apiKey가 "PASTE..."로 시작하면 동기화 기능이 꺼진 채
//  로컬 전용으로 동작합니다.)
//
// 추가 설정(콘솔에서):
//  1) Authentication → 로그인 방법 → Google 사용 설정
//  2) Authentication → 설정 → 승인된 도메인에 'goguma613.github.io' 추가
//  3) Firestore Database 만들기(프로덕션 모드) + 아래 보안 규칙 적용:
//       rules_version = '2';
//       service cloud.firestore {
//         match /databases/{database}/documents {
//           match /users/{uid} {
//             allow read, write: if request.auth != null && request.auth.uid == uid;
//           }
//         }
//       }

export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT",
  storageBucket: "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};
