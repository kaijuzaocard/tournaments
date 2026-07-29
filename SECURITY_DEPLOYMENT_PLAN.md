# 怪獸造咔賽事行事曆安全部署計畫

適用範圍：Google Firebase Auth 管理員登入、敏感 listener 隔離、Firestore 最小權限 Rules。
目前狀態：本機實作與 Emulator 驗證階段；正式 Google Firebase Auth UID 已核對並設定，尚未 push、部署或接觸 Production 資料。

## 1. 修改前備份現有 Firestore 資料

以下步驟會讀取 Production，必須由具備正式專案權限的人員執行：

1. 在 Firebase／Google Cloud Console 確認目標 project 是 `kaijuzaocard-tournaments`。
2. 確認 Firestore 資料庫位置與備份目的地 bucket。
3. 使用 Firestore managed backup，或使用 Google Cloud CLI 匯出：

   ```powershell
   gcloud firestore export gs://<BACKUP_BUCKET>/calendar-security-<YYYYMMDD-HHMM> --project=kaijuzaocard-tournaments
   ```

4. 等待 operation 完成，記錄 operation ID、bucket 路徑、時間與執行帳號。
5. 驗證備份包含 `artifacts` collection。
6. 另外保存部署前 Firestore Rules 文字與 Rules release/version，供緊急 rollback。

不得將匯出的 Production 資料、API key、Token 或服務帳戶金鑰加入 Git。

## 2. 取得管理員 Firebase Auth UID

1. 在 Firebase Console 啟用 Google sign-in provider。
2. 將正式網域與本機測試網域加入 Authentication authorized domains。
3. 本機啟動新版前端：

   ```powershell
   npm run dev
   ```

4. 打開店家後台，點「使用 Google 管理員帳號登入」。
5. 使用指定的店長 Google 帳號登入。
6. 尚未命中 allowlist 時，畫面會顯示該 Firebase project 下的完整 UID 與 Email，但不開放後台。
7. 至 Firebase Console → Authentication → Users 交叉核對 UID、provider 為 Google、Email 為指定管理員帳號。

Firebase UID 是 project-scoped identifier。同一個 Google 帳號在其他 Firebase project 的 UID 不可直接假設相同。

## 3. 設定管理員 allowlist

本版採 **UID allowlist 過渡方案**。

### 前端

在 Vercel 或本機 `.env.local` 設定：

```text
VITE_FIREBASE_ADMIN_UIDS=<UID_1>,<UID_2>
```

前端集中由 `src/adminAuth.js` 解析，不應在元件中重複 UID。

### Firestore Rules

確認 `firestore.rules` 的 `isAdmin()` 靜態 UID 陣列與前端環境變數使用同一組已核對 UID。不要把 UID 再複製到 React 元件或其他業務模組。

部署前執行：

```powershell
rg -n "REPLACE_WITH_CALENDAR_ADMIN_UID" firestore.rules
```

只要仍有結果，就停止部署。

前端 allowlist 只控制操作入口；Firestore Rules allowlist 才是資料庫授權。由於 Rules 不能讀取 Vite 環境變數，過渡期必須在兩個 enforcement layer 同步同一份 UID，並由部署 checklist 核對。

### 未來改用 custom claims

較成熟的方案是由受信任的 Admin SDK 工具一次性設定：

```js
await admin.auth().setCustomUserClaims(uid, { admin: true });
```

屆時需要：

1. 建立受控、可稽核的 claim 管理流程；不可放在瀏覽器。
2. Rules 改為檢查 `request.auth.token.admin == true`，並繼續拒絕 anonymous provider。
3. 前端以 `getIdTokenResult()` 讀取 claim，不再使用 Vite UID allowlist。
4. 設定或撤銷 claim 後，要求管理員重新登入或 force-refresh ID token。
5. 以 Emulator 覆蓋 admin claim、一般 Google 帳號與匿名帳號。
6. 分階段部署前端與 Rules，並保留 UID allowlist 的短期回復路徑。

## 4. 啟動 Emulator

必要條件：

- Node.js 可執行。
- Java 21 或相容 JRE 已在 `JAVA_HOME`／`PATH`。
- 已執行 `npm install`。

執行：

```powershell
npm run test:rules
```

runner 會：

1. 使用固定 demo project `demo-kaijuzaocard-calendar`。
2. 只啟動 Firestore Emulator。
3. 將 Rules 與 emulator config 複製到系統 temp 的 ASCII 路徑，避開 Windows Java 中文路徑問題。
4. 執行 `tests/firestoreRules.test.js`。
5. 測試結束後關閉 Emulator。

此流程不應連線 Production。

## 5. 執行 Rules 測試

```powershell
npm run test:rules
npm run build
npm run lint
git diff --check
```

Rules 測試至少應維持：

- 公開活動匿名可讀。
- 公開活動只有 allowlisted Google admin 可寫。
- 合法匿名新手預約可建立。
- 預約不可由匿名使用者讀、list、更新或刪除。
- `note_presets` 只允許管理員。
- 未知路徑預設拒絕。
- 匿名帳號即使 UID 字串碰巧等於 allowlist，也不能取得管理員權限。

## 6. 為什麼先部署新版前端，再發布 Rules

舊前端有三個與新 Rules 不相容的行為：

1. 所有使用者都訂閱 `tutorial_reservations`。
2. 所有使用者都訂閱 `note_presets`。
3. 管理入口只使用前端密碼，不具備 Google Firebase Auth 管理員 UID。

若先發布 Rules：

- 匿名前台會收到敏感 collection 的 `permission-denied`。
- 舊後台沒有符合 `isAdmin()` 的 Google Auth 身分，管理功能會立刻失效。

正確順序是先讓新版前端停止非管理員 listener、支援 Google 管理員登入，再部署 Rules。舊 Rules 過寬的風險只應維持在最短的受控切換窗口。

## 7. 新版前端部署後驗證

以下步驟會接觸 Production 網站與 Firebase Auth，但不應修改業務資料：

1. 確認 Vercel Production 使用預期 commit。
2. 一般／無痕視窗開啟前台，確認活動、分類、福利圖與營業日正常載入。
3. 在 DevTools Network／Console 確認匿名使用者沒有查詢：
   - `tutorial_reservations`
   - `note_presets`
4. 開啟後台，確認不再出現密碼輸入。
5. 使用非 allowlisted Google 帳號登入，確認顯示 UID 但無法進入後台。
6. 使用 allowlisted Google 管理員登入，確認後台開啟後才建立預約與備註模板 listeners。
7. 登出後確認 Firebase 切回匿名使用者，敏感 listeners 立即解除，預約與模板 state 清空。
8. 不在此階段新增、修改或刪除活動／預約。

若上述任一步失敗，不發布 Rules。

## 8. Rules 發布後無痕視窗測試

Rules 發布是 Production 權限變更。只允許精準部署：

```powershell
npx firebase-tools deploy --only firestore:rules --project kaijuzaocard-tournaments
```

不得使用不含 `--only` 的完整部署命令。

發布後：

1. 無痕視窗開啟前台，確認公開活動可讀。
2. 提交一筆明確標記的測試新手預約：
   - UI 只在 Firestore create 成功後顯示成功。
   - 匿名使用者不能在 DevTools 或前端列出預約 collection。
3. 使用一般 Google 帳號確認不能進後台、不能讀 `note_presets`／`tutorial_reservations`。
4. 使用 allowlisted Google 管理員確認活動管理、模板與預約清單正常。
5. 管理員登出後確認敏感 listener 解除。
6. 檢查 Console 不應有非預期 `permission-denied`。
7. 測試預約若含個資，完成後只由管理員依正式 UI 處理；不要用 Console 手動改資料。

## 9. 問題發生時 rollback

### 前端 rollback

1. 在 Vercel 將 Production alias 回復到上一個已驗證 deployment。
2. 若 Rules 已發布，不可長時間回復到不支援 Google Auth 的舊前端；優先 fix-forward 新前端。

### Rules rollback

1. 使用部署前保存的完整 Rules 版本建立明確 rollback file。
2. 先在 Emulator 執行最小 smoke test。
3. 精準部署：

   ```powershell
   npx firebase-tools deploy --only firestore:rules --project kaijuzaocard-tournaments
   ```

4. 立即重新驗證公開讀取、匿名預約 create 與管理員操作。

舊 Rules 允許任何 authenticated user 寫全庫，屬高風險狀態。回復舊 Rules 只能作短暫緊急措施，應立即安排 fix-forward。

Rules 變更不修改既有 Firestore 文件，因此一般 rollback 不需要資料 migration。若切換期間發現未授權寫入，需另行做 audit，不可直接猜測或批次刪除。

## 10. 會接觸 Production 的步驟

| 步驟 | 是否接觸 Production | 是否寫入業務資料 |
|---|---:|---:|
| 本機 build／lint／Emulator | 否 | 否 |
| Firestore export／managed backup | 是 | 不修改 Firestore；會建立備份檔 |
| Firebase Console 啟用 Google provider／authorized domain | 是 | 修改 Auth 設定 |
| 查閱 Authentication Users 取得 UID | 是 | 否 |
| 設定 Vercel env／部署前端 | 是 | 修改部署設定／前端版本 |
| 前端唯讀 smoke test | 是 | 否 |
| 發布 Firestore Rules | 是 | 修改存取權限 |
| 建立測試預約 | 是 | 是，新增一筆預約 |
| 管理員刪除測試預約 | 是 | 是，刪除該測試文件 |

本文件本身不授權執行上述 Production 步驟；每次正式部署仍需確認目標 project、UID、備份與核准範圍。
