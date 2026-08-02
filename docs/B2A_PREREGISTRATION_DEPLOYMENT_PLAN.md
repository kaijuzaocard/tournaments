# B2A 賽事預報名部署計畫

狀態：僅供後續核准部署使用。本文件不授權本批建立 Secret、TTL、部署或操作 Production 報名資料。

## 1. 前置條件

1. Calendar 功能分支測試、build、lint、Rules emulator、Functions + Firestore emulator 全部通過。
2. 確認 Firebase project 為 `kaijuzaocard-tournaments`、database 為 `(default)`。
3. 使用 Node.js 22；emulator/CI 使用 Java 21 與 `demo-*` project ID，不載入 Production credentials。
4. 備份目前共用 `firestore.rules` 與兩個既有 Functions deployment revision；記錄 Calendar 上一個 READY Production deployment。

## 2. Secret

建立高熵 HMAC Secret：

```powershell
npx --yes firebase-tools functions:secrets:set CALENDAR_REGISTRATION_HMAC_KEY --project kaijuzaocard-tournaments
```

- 建議至少 32 個隨機 bytes；不得放入 Git、`.env`、Vercel、Console log 或文件。
- 僅綁定 `submitTournamentPreRegistration` 與 `manageTournamentPreRegistration`。
- Secret 缺失時 Functions 必須 fail closed；不可提供預設值。
- 輪替會改變 deterministic token，因此需先制定雙金鑰驗證窗口，本批不直接輪替。

## 3. TTL

只設定：

- collection group：`tournamentPreRegistrationRateLimits`
- field：`expiresAt`

不得套用 `monster_tournaments`, `tournamentPreRegistrations`, `entries`, `identities`, `operations` 或 `tournamentPreRegistrationStats`。TTL 是非即時清理，不作限流正確性的依據。

## 4. 精準部署順序

1. 建立 `CALENDAR_REGISTRATION_HMAC_KEY`。
2. 精準部署兩個 Functions：

```powershell
npx --yes firebase-tools deploy --project kaijuzaocard-tournaments --only functions:submitTournamentPreRegistration,functions:manageTournamentPreRegistration
```

3. 驗證 Callable 存在與 Secret 綁定後，發布完整 Calendar + Catalog + B2A 合併 Rules。舊 Production 前端不讀新路徑，因此此步不破壞既有流程：

```powershell
npx --yes firebase-tools deploy --project kaijuzaocard-tournaments --only firestore:rules
```

4. 部署 Calendar Preview，使用專用測試活動驗證提交、重播、管理、修改、取消、額滿、截止與管理員名單 listener 清除。
5. 確認 B1、Catalog 公開讀取與 tutorial reservations 無回歸。
6. 部署 Calendar Production frontend，先保持所有既有活動 `preRegistration` 缺失/關閉。
7. 完成 Production 回歸後，等待 rate-limit collection group 可選取，再精確設定 TTL。
8. App Check 保持 monitor；另批觀察與核准後才 enforce。

不得部署 Storage、Hosting、indexes、其他 Functions，或先讓 Preview 以 permission-denied 運作。

## 5. Preview / Production 驗收

- 公開頁只顯示 active count/capacity，不可讀 entries。
- 未登入顧客提交成功；回應遺失後以同 requestId 重播取得相同 management link。
- Fragment 在 Firebase/React 載入前清除；localStorage/sessionStorage/Console 無 token。
- 正確 token 只讀本人資料，可修改四欄並取消；錯誤 token 與不存在 entry 回應一致。
- 管理員 Modal 開啟才建立 listener，關閉/登出立即 unsubscribe。
- B1 建立 Swiss 仍是空白玩家名單，payload 無 registration entry。
- App Check 先 monitor，記錄 abuse 指標後另批核准 enforce。

## 6. 回退

1. 前端異常：Vercel alias 回退上一個 READY deployment；已寫 entries 保留。
2. Function 異常：先關閉受影響活動 `preRegistration.enabled`，再回退兩個精準 Functions revision；不刪 entry。
3. Rules 異常：回退完整共用 Rules，不得只發布 B2A 片段，也不得移除 Catalog 或 tutorial permissions。
4. Secret/Token 異常：停止新提交，保留資料與 operation；不得重設成弱金鑰。
5. 不以刪除活動或遞迴刪除 private subtree 作回退。

## 7. B2B 延伸界線

B2B 另建版本化、短效、一次性 server-side handoff。只傳 active entry 的五個 allowlisted 欄位，不傳 token/hash/IP/operation，不修改 B1 handoff schema，不把玩家名單放 URL。

## 8. Dependency reachability gate (2026-08-03)

Deployment source: `b141fd6b43011483c21b5740ad6e9b7f653ea2cc`.

### Root production audit

`npm audit --omit=dev --json` reports two transitive production findings:

- High: `@grpc/grpc-js@1.9.15`, through `firebase@12.11.0 -> @firebase/firestore@4.13.0`. Advisories `GHSA-5375-pq7m-f5r2` and `GHSA-99f4-grh7-6pcq`; patched in the 1.9 line at `1.9.16`.
- Critical: `websocket-driver@0.7.4`, through `firebase@12.11.0 -> @firebase/database@1.1.2 -> faye-websocket@0.11.4`. Advisories `GHSA-mp7j-qc5w-4988` and `GHSA-xv26-6w52-cph6`; patched at `0.7.5`.

These installed packages are not reachable from the B2A browser runtime:

- Source imports only `firebase/app`, `firebase/auth`, `firebase/firestore`, and `firebase/functions`; it does not import `firebase/database`.
- Firebase and Firestore conditional exports select the browser ESM entries (`firebase/*/dist/esm` and `@firebase/firestore/dist/index.esm.js`). The vulnerable gRPC package belongs to Firestore's Node export.
- A programmatic Vite production build captured 1,747 transformed modules. It contained zero modules from `@grpc/grpc-js`, `@firebase/database`, `faye-websocket`, or `websocket-driver`.
- The public activity page, anonymous callable submission, management-link view, and admin dialog all execute through that same browser bundle. Anonymous callables use the browser `firebase/functions` client; the callable server runtime comes from the separate `functions/package-lock.json`.

Decision: the root high/critical findings are accepted temporarily for B2A because neither affected implementation is present in the production browser module graph. This is not a general acceptance for Node use of the root Firebase package.

### Functions audit

The Functions package reports seven moderate transitive findings and no high or critical findings. The underlying advisory is `GHSA-w5hq-g745-h8pq` for `uuid` v3/v5/v6 with a caller-provided output buffer; patched at `11.1.1` (and corresponding later release lines).

The production Functions entry imports only `firebase-admin/app`, `firebase-admin/firestore`, Node `crypto`, and `firebase-functions` callable/params APIs. A runtime module-load trace confirms that it loads `@google-cloud/firestore` and patched `@grpc/grpc-js@1.14.4`, but does not load `@google-cloud/storage`, `uuid@9.0.1`, the vulnerable `gaxios@6.7.1`, `retry-request@7.0.2`, or `teeny-request@9.0.0`. B2A does not call UUID v3/v5/v6 or provide an output buffer.

Decision: the Functions moderate findings are not reachable from either exported callable and are accepted temporarily for this release.

### Follow-up remediation

Do not run an unreviewed `npm audit fix` in this release. Create a separate dependency-only change that refreshes the transitive lock entries to at least `@grpc/grpc-js@1.9.16` and `websocket-driver@0.7.5`, then rerun the complete frontend, Rules emulator, Functions emulator, build, lint, and module-graph checks. Track Firebase Admin's Storage dependency until it carries a patched uuid line even though B2A does not load that optional service.
