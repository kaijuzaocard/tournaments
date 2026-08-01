# 怪獸造咔系統整合藍圖

文件版本：B0 / 1.0
查證日期：2026-08-01（Asia/Taipei）
性質：現況盤點與決策文件，不是實作規格或部署授權

## 查證範圍與限制

- 依本機 repository、`origin/main` Git 物件、既有版本化契約與使用者提供的正式網址查證。
- 未讀取或寫入 Production 業務資料，未查詢個資，未修改 Rules、Vercel、n8n 或 Firebase 設定。
- 本次沒有修改任何程式碼、沒有 commit、push、deploy 或 migration。
- 榮耀與收購的原始 checkout 各落後 `origin/main` 兩個 commit；這兩套現況以 `origin/main` 為準，未執行 pull。
- Odoo、未來 POS、n8n 主機、Google Forms/Sheets 與 LINE OA 的線上設定不在目前 repositories；其實際 runtime 行為僅能標示為未查證。

# 1. 系統總覽

| 系統 | 正式入口 / 專案 | 目前責任 | 主要資料存放 | 權威 ID | 現有串接 |
|---|---|---|---|---|---|
| 賽事行事曆 | `https://kjzc-tournaments-vert.vercel.app/`；Firebase `kaijuzaocard-tournaments` | 公告活動、日期時間、費用、說明、圖片、新手預約 | Firestore `artifacts/{appId}/public/data/*` | 行事曆 event document ID | 新手預約另呼叫 GAS；尚未串瑞士制 |
| 瑞士制配對 | `https://swiss-tournament-one.vercel.app/`；Vercel project `swiss-tournament` | 現場報名、配對、結果、排名、淘汰賽、JSON v2 | React state + localStorage；選用 Firestore current/archive；QR 報名另存 Firestore | `tournamentId` | 讀榮耀 game contract；手動 JSON v2 匯出給榮耀 |
| 榮耀系統 | `https://zaocard-honor-system.vercel.app/`；Firebase `zaocard-honor-system` | 會員、點數、EXP、戰績、票券、稱號、徽章、獎勵、賽事匯入、收購後端 | Firestore + Gen 2 Functions + Storage | Firebase Auth UID | 瑞士制 JSON v2；收購 Functions；公開鏡像投影 |
| 賽事獎勵計算 | `https://swiss-reward-tool.vercel.app/`；Vercel project `swiss-reward-tool` | 店務試算、成本與獎勵方案參考 | localStorage；可選 Firebase `users/{uid}/tournamentProfiles/{profileId}` | `profileId` | 無賽事、玩家或實際發獎串接 |
| 線上型錄 | `https://kjzc-catalog.vercel.app/`；Firebase `kaijuzaocard-tournaments` | 顧客商品展示、分類、後台商品編輯 | Firestore `artifacts/kaijuzaocard-catalog/public/data/*` | 商品 document ID；另有業務 SKU 欄位時以 SKU 表意 | 與行事曆共用 Firebase project/Rules，不等於共用業務資料 |
| 卡片收購 | `https://zaocard-price.vercel.app/`；Vercel project `zaocard-price` | 卡價估算、收購送件、Token 查詢、管理處理 | 榮耀 Firebase：`buyback_requests` 與後端索引/operation | request document ID；`orderNumber` 只供顯示/索引 | `submitBuybackRequest`、`getBuybackRequestStatus` Functions |
| 文案生成器 | 本機 repo；無 Firebase dependency | 產生店務文案並帶入行事曆、型錄、LINE 網址 | localStorage / UI state | 無跨系統權威 ID | 只輸出網址與文字，未見 n8n API |
| 營收試算表 | Apps Script 檔案，非 Git repo | Google Sheet 營收輸入與查詢 | Google Sheets | 試算表列/日期等既有欄位 | 未見 Firebase、n8n、Odoo API |
| Odoo POS | repository 未提供 | 目前應視為訂單、付款、庫存的正式權威候選 | 未查證 | 未查證 | 未查證 |
| 未來 POS | 尚未實作 | 只有在權威與同步規則確定後才可進場 | 尚無 | 尚無 | 尚無 |
| n8n / Forms / Sheets / LINE OA | 外部輔助流程 | 通知、文案、表單或營運輔助，不應成為核心交易權威 | 外部服務，未查證 | 外部 workflow / row / message ID | repo 內只確認到行事曆 GAS webhook 與文案連結 |

主要證據：

- 行事曆：`賽事行事曆-git推送自動部署/src/App.jsx`、`firestore.rules`
- 瑞士制：`賽事配對工具-git推送自動部署/src/utils/tournamentMetadata.js`、`integrationContracts.js`、`cloudSync.js`、`registration.js`
- 榮耀：`zaocard-system/firestore.rules`、`functions/index.js`、`src/utils/swissImport.js`
- 獎勵工具：`賽事獎勵計算-git推送自動部署/FIREBASE_SETUP.md`、`src/lib/cloudProfileSync.ts`
- 型錄：`線上型錄-git推送自動部署/src/App.tsx`
- 收購：`卡片收購系統-VercelCLI手動部署/src/utils/buybackApi.js` 與榮耀 `functions/buybackRequestService.js`

# 2. 工具責任劃分

| 領域 | 寫入權威 | 其他工具可做 | 不可做 |
|---|---|---|---|
| 活動公告與正式獎勵圖文 | 行事曆 | 瑞士制接收基本 metadata；n8n 未來唯讀取材 | 獎勵計算器不得覆蓋公告內容 |
| 賽事執行、桌次、結果、排名、Top Cut | 瑞士制 | 榮耀匯入完成後的 JSON v2 結果 | 行事曆、n8n、獎勵計算器不得直接改賽事 state |
| 會員、點數、EXP、徽章、稱號、票券、公開鏡像 | 榮耀系統 | 瑞士制提供結果檔；POS 未來只經受控 API 請求 | Client、瑞士制或 POS 不可直接改私有 Firestore 文件 |
| 獎勵試算方案 | 獎勵計算工具的已確認 profile | 店員參考後人工回填行事曆公告 | 不直接發點、發券、改賽事或當作官方公告權威 |
| 商品展示內容 | 線上型錄 | n8n 未來唯讀取材 | 不宣稱為即時庫存或付款權威 |
| 訂單、付款、庫存 | Odoo POS（暫定現行權威） | 型錄顯示、榮耀記錄會員權益 | 未來 POS 未決前不可雙主寫入 |
| 收購申請、估價、處理狀態 | 收購流程，資料落在榮耀 Firebase | 管理員後台處理；榮耀 Functions 控制提交/查詢 | orderNumber 不可作讀取授權，前端不可直接 create/read |
| 自動文案與通知 | n8n / GAS / LINE OA 輔助 | 唯讀擷取已發布資料、產生通知 | 不可成為賽事、會員、庫存或付款權威 |

# 3. 資料權威矩陣

| 資料 | 權威系統 | 權威鍵 | 可接受副本 | 同步方向 |
|---|---|---|---|---|
| 行事曆活動 metadata | 行事曆 | `calendarEventId` = Firestore doc ID | 瑞士制 tournament metadata snapshot | Calendar → Swiss（B1） |
| 活動圖片與說明 | 行事曆 | `calendarEventId` | n8n 發文內容、瑞士制唯讀參考（若未來需要） | Calendar → consumers；禁止反寫 |
| 賽事執行 state | 瑞士制 | `tournamentId` | localStorage、同 UID cloud current/archive | Swiss 內部同步 |
| 賽事結果 | 瑞士制完成狀態 | `tournamentId` | JSON v2 import record | Swiss → Honor（既有） |
| 玩家長期身分 | 榮耀 | Firebase Auth UID | Public Mirror 的遮罩/allowlist 投影 | Private → Projection |
| 玩家可讀自選 ID | 榮耀 | `honorIdNormalized` 唯一索引 | profile/public mirror 顯示 | Honor 內部；不得當 doc key |
| 單場玩家 | 瑞士制 | `player.id` | round/table reference | 只在該 tournament 內有效 |
| 官方遊戲玩家 ID | 瑞士制輸入/JSON v2 | `officialPlayerId` 類欄位 | 榮耀匯入比對資料之一 | 不可取代 Firebase UID |
| 遊戲種類 | 各工具共享契約 | `gameCode` | 各工具 display name | 共享穩定代碼，不共享資料庫 |
| 商品展示 | 型錄 | product doc ID / SKU | n8n 文案、未來 POS 對照 | Catalog → consumers；庫存仍由 POS |
| 收購申請 | 收購後端 | buyback request doc ID | order index、operation、管理畫面 | Functions → Firestore |
| 收購顯示單號 | 收購後端 | `orderNumber` | 顧客與店員顯示 | 不是授權鍵；查詢需 lookup token |
| 獎勵試算 profile | 獎勵工具 | `profileId` | 本機/同 UID cloud profile | 不流入玩家或正式獎勵資料 |

# 4. 共用 ID 策略

| ID | 產生者 | 穩定範圍 | 是否作 document key | 串接規則 |
|---|---|---|---|---|
| `calendarEventId` | 行事曆 Firestore `addDoc` | 活動生命週期 | 是，行事曆 event doc key | B1 複製到 Swiss metadata；不得改寫成 tournamentId |
| `tournamentId` | 瑞士制 `createTournamentFromInput()` | 單場賽事及其匯出/封存 | 是，Swiss cloud archive 與 Honor import record | 只在店員確認建立時產生；同一 JSON v2 重送保持相同 |
| Firebase Auth UID | Firebase Auth | 玩家/管理員帳號生命週期 | 榮耀 player 私有資料 key | 長期玩家主鍵；不得用 Honor ID 取代 |
| Honor ID | 榮耀後端 | 可修改的使用者識別 | 否；另有 normalized unique index | 顯示/查找用途，不作跨系統主鍵 |
| `player.id` | 瑞士制 | 單一 tournament | 只作 tournament 內 reference | 不可跨賽事或對應榮耀 UID |
| `gameCode` | 共用版本化字典 | 跨工具 | 否 | `ptcg/ucg/godzilla/nivel/other/custom_*`；顯示文字可變 |
| 商品 doc ID / SKU | 型錄或 POS | 商品生命週期 | doc ID 視現況；SKU 為業務 reference | 未來 POS 串接前需決定 SKU 權威與碰撞規則 |
| buyback request ID | 收購後端 | 申請生命週期 | 是 | 僅內部；顧客不應取得完整 doc path |
| `orderNumber` | 收購後端 | 顯示與索引 | 否 | 不作授權；搭配安全 lookup token |
| n8n workflow/group ID | n8n | 未查證 | 未查證 | 不得被核心系統當業務主鍵 |

共同原則：共享 reference，不共享主鍵；只有 `gameCode` 是真正的跨工具語意代碼。任何跨工具 payload 都必須帶自己的 `schemaVersion`，且不能把 JSON v2 的 `schemaVersion` 與 B1/B2 handoff 版本混用。

# 5. 串接決策清單

| 關係 | 決策 | 階段 | 是否即時 | Functions / Rules | 理由 |
|---|---|---|---|---|---|
| 行事曆 → 瑞士制 | **現在做** | B1 | 使用者觸發、一次性交接 | 否 / 否 | 只傳無個資 metadata，店員確認後建立空白賽事 |
| 行事曆報名 → 瑞士制 | **稍後做** | B2 | 批次/受控 handoff | 很可能需要 / 需要 | 涉及玩家與聯絡資料、容量、截止、重放 |
| 瑞士制 → 榮耀 | **已存在，保留** | 現況；B3 改善 UX | 手動 JSON v2 | 現況不必新增 | 已有 tournamentId、preview、transaction、重複保護 |
| 瑞士制 → 獎勵計算器 | **永遠不串** | Never | 無 | 無 | 正式獎勵圖文以行事曆為準；計算器只供人工參考 |
| 行事曆 → 榮耀 | **不直接串** | B3 仍經 Swiss 結果 | 無直接同步 | 無 | 行事曆不是賽事結果權威，也沒有玩家對應 |
| 行事曆 → n8n | **稍後唯讀** | B4 | 排程/事件讀取 | 視部署而定 | 只讀已發布活動與官方圖文 |
| 型錄 → n8n | **稍後唯讀** | B4 | 排程/事件讀取 | 視部署而定 | 只讀商品展示，不改商品或庫存 |
| 型錄 → POS | **高風險稍後** | B5 | API/事件 | 是 | 必須先定義 SKU、庫存權威、冪等與回滾 |
| 榮耀 → POS | **高風險稍後** | B5 | 受控 API | 是 | 涉及點數、票券、付款與對帳 |
| 收購 → 榮耀 | **已存在** | 現況 | Callable/transaction | 已有 | 同一 Firebase project，由安全 Functions 管理 |
| 收購 → POS | **高風險稍後** | B5 | 受控 API | 是 | 涉及現金/點數結案與商品入庫 |
| 全工具共用 Firestore | **永遠不做** | Never | 不適用 | 不適用 | 擴大 blast radius、權限耦合與資料誤寫風險 |
| 將任一工具嵌入另一工具 | **不作 B1 前提** | Later only if justified | 不適用 | 不一定 | 保持可獨立開啟、獨立回滾與獨立部署 |

# 6. 已存在的串接

1. **Swiss → Honor JSON v2**：瑞士制匯出完成賽事；榮耀管理員手動選檔、預覽、玩家對應並確認。`tournamentId` 是 import record key；私有 stats 與 import record 在 transaction 中更新。這是目前唯一正式賽事結果串接。
2. **Swiss → Honor game contract（唯讀）**：瑞士制有獨立 `honorContractFirebase`，固定驗證 `zaocard-honor-system`，只讀 published contract pointer/snapshot。
3. **Honor private → Public Mirror**：Cloud Function projection，由私有 profile/stats 產生 v4 allowlist 公開鏡像；Client 不可寫。
4. **Buyback frontend → Honor Functions**：顧客提交與 Token 查詢走 `submitBuybackRequest` / `getBuybackRequestStatus`；正式 `origin/main` 已移除顧客直接 `addDoc/getDocs`。
5. **Calendar → GAS**：只有新手預約提交後的通知 webhook；活動新增/修改不會觸發。
6. **Copy generator → Calendar/Catalog/LINE**：只把網址放入文案；沒有資料 API。
7. **Calendar + Catalog shared Firebase project/Rules**：同 project 但不同 app namespace/collections；這是基礎設施共用，不是業務資料串接。

# 7. B1 範圍

B1 只做：

- 行事曆管理員在單一活動按「建立瑞士制賽事」。
- 將下列 v1 payload 送到瑞士制：

```json
{
  "schemaVersion": 1,
  "handoffId": "one-time-random-id",
  "calendarEventId": "opaque-event-id",
  "name": "event name",
  "gameCode": "ptcg",
  "eventDate": "2026-08-01",
  "startTime": "14:00",
  "entryFee": 300,
  "capacity": 32,
  "suggestedRounds": 5,
  "suggestedTopCut": 8
}
```

- 瑞士制嚴格驗證、顯示確認畫面；只有店員確認後才呼叫 `createTournamentFromInput()`。
- 建立的是空白 tournament；玩家仍由現場 QR 或手動加入。
- 瑞士制建立後回傳 `calendarEventId + tournamentId` 給原行事曆視窗，行事曆只保存連結 metadata。

B1 明確不做：玩家名單、電話、Honor ID、預報名、獎勵計算、實際發獎、結果回傳、共用資料庫、直接跨 project Firestore 寫入。

# 8. B1 交接方案比較

| 方案 | 安全 | 實作量 | URL 長度 | 跨裝置 | Functions/Rules | B2 延展 | 結論 |
|---|---|---|---|---|---|---|---|
| A. 多個 query parameters | 中 | 低 | 中 | 可開連結 | 否 | 差 | 欄位易漂移、編碼與未知欄位處理分散，不選 |
| B. URL-safe encoded JSON | 高（限無敏感 metadata） | 低至中 | 小 payload 可接受 | 可轉傳連結 | 否 | 中 | **B1 推薦**；需嚴格 schema、大小與來源驗證 |
| C. 短效 handoff document | 高 | 中至高 | 短 | 最佳 | 是 / 是 | 高 | B2 涉及報名/個資時採用，不在 B1 提前建設 |
| D. Swiss 直接讀 Calendar Firestore | 低 | 中 | 無 | 可 | 可能 | 差 | 跨工具權限耦合、違反責任邊界，拒絕 |
| E. 人工複製貼上 JSON | 高但 UX 差 | 低 | 不適用 | 可 | 否 | 差 | 只作緊急 fallback，不作正式 B1 |

# 9. 建議的 B1 架構

## 9.1 傳輸

- Calendar 以 canonical JSON serialization 產生 v1 payload，再用 UTF-8 base64url 放入單一 `handoff` query parameter。
- URL 只含無個資 metadata；建議限制 decoded payload ≤ 2 KiB、整體 URL ≤ 4 KiB。
- Swiss 解碼後先做 exact-key validator；拒絕未知欄位、錯誤型別、非法日期/時間、非安全整數與非法 `suggestedTopCut`。
- URL 不是授權憑證。它只預填確認頁，不會自動建立或覆寫賽事。
- `source` 不由 Calendar 傳入；Swiss normalizer 固定設定 `source: "calendar"`。
- `handoffId` 是每次開窗產生的一次性安全亂數，只用來綁定 popup session 與 success message，不寫入賽事或 Firestore。
- Calendar 以 `VITE_SWISS_APP_URL` 指定 Swiss URL，並以 `VITE_SWISS_ALLOWED_ORIGINS` 加入精確 origin；Swiss 以 `VITE_CALENDAR_ALLOWED_ORIGINS` 加入精確 Calendar origin。Production 與 Preview 都必須使用固定 origin，不接受 `*` 或任意 `*.vercel.app`。
- Swiss 同時驗證 allowlist、`document.referrer` 與 query `sourceOrigin` 一致；無法確認來源時 fail closed。

## 9.2 建立與回寫

1. Calendar 使用 `window.open()` 開 Swiss 官方 allowlist origin。
2. Swiss 顯示 payload、來源活動 ID、差異與警告。
3. 店員確認後 Swiss 產生新的 `tournamentId`，並保存 `calendarEventId`。
4. Swiss 以 `window.opener.postMessage()` 回傳最小結果：`type`, `schemaVersion`, `handoffId`, `calendarEventId`, `tournamentId`。
5. Calendar 驗證 message origin、popup window、type、schema、handoff ID、目前登入管理員與 event ID 後，以 transaction 在自己的 event doc 寫入：
   - `swissIntegration.schemaVersion: 1`
   - `swissIntegration.swissTournamentId`
   - `swissIntegration.linkedAt`（server timestamp）
   已有相同 ID 時不重寫時間；已有不同 ID 時停止並要求人工確認。
6. 不回寫桌次、玩家、結果或任何 Swiss state。

## 9.3 重複防護

- Calendar 是全域 handoff guard：event doc 已有 `swissTournamentId` 時，不再建立第二場，只顯示已連結。
- Swiss 是第二層 guard：完成 cloud current/archive 同步後，在目前 state 與合併後 history 中搜尋相同 `calendarEventId`；找到即開啟/提示既有賽事，不產生新 ID。若同一 event 對應多個不同 tournament ID，顯示 conflict 並停止。
- 若第一次 callback 遺失，下次 handoff 由 Swiss 找到既有賽事並重新 postMessage，可補回 Calendar link。
- 同瀏覽器的同時建立以 Web Locks API 排他執行，鎖內重新讀取 localStorage 並再查重；瀏覽器沒有安全 lock 能力時 fail closed。
- 不同 Swiss 管理員 UID 無法互讀 cloud archive；但 Calendar event 的 `swissTournamentId` 仍會阻止再次建立。若原賽事不可取得，必須人工處理，不得靜默產生第二場。
- B1 不宣稱能阻止使用者繞過 handoff、在 Swiss 手動建立內容相同但沒有 `calendarEventId` 的賽事。

## 9.4 更新與刪除

- Calendar 活動修改後不自動推送。B1 再次開啟既有關聯只定位既有賽事，不更新或覆寫 tournament metadata。
- Calendar event 刪除不級聯刪除 Swiss tournament。
- Swiss tournament/archive 刪除不自動清除 Calendar link；Calendar 顯示「連結失效，需要人工確認」。
- 重新建立前必須有明確 unlink/recreate 操作與提示；B1 不做自動解除。

## 9.5 `topCut` 語意

- Calendar v1 payload 的 `suggestedTopCut` 是**預定值**。
- Swiss 正式 `metadata.topCut` 是**實際已進入淘汰賽的人數**，新賽事保持 0，直到 `enterKnockout(topN)`。
- B1 adapter 把 handoff `suggestedTopCut` 當確認提示；不可提前把實際 `topCut` 寫成非 0。

## 9.6 B1 是否需要 Functions / Rules

- **Functions：不需要。**
- **Firestore Rules：不需要修改。** Calendar 既有 Rules 已允許 allowlist 管理員更新自己的 event doc；Swiss 使用既有 local/cloud state。
- 若產品要求「不同 Swiss 管理員帳號也能直接開啟同一 tournament」或「無 Calendar 原視窗也要完成回寫」，則 B1 必須升級到 C 方案，新增後端 handoff/index 與 Rules；不可偷偷讓 Swiss Client 直接寫 Calendar Firestore。

# 10. B1 使用者流程

1. 管理員在行事曆建立/編輯活動，補齊 gameCode、日期、時間、費用、容量、輪數與預定 Top Cut。
2. 按「建立瑞士制賽事」。
3. Calendar 本地先驗證欄位；若 event 已有 `swissTournamentId`，改顯示「已建立」並阻止重複。
4. 開啟 Swiss 確認頁，顯示所有將帶入欄位；不帶玩家/個資。
5. Swiss 驗證 payload 並搜尋相同 `calendarEventId`。
6. 若已存在，開啟既有賽事或顯示來源裝置/帳號限制；不建立新賽事。
7. 若不存在，店員按「確認建立空白賽事」。
8. Swiss 建立 `tournamentId`、保存 metadata、維持 players/rounds 為空。
9. Swiss 回傳 linked result；Calendar 寫回 reference 欄位。
10. 現場使用 QR 或手動方式加入玩家並開始賽事。
11. 完賽後仍使用既有 JSON v2 匯入榮耀，不經獎勵計算工具。

# 11. B2 延展

B2 才加入預報名，建議延展如下：

- Calendar 增加 `preRegistrationEnabled`, `registrationCapacity`, `registrationDeadline`。
- 每筆報名有不可猜測 `registrationId`；PII 與公開活動資料分離。
- Calendar/受控後端仍是預報名權威；Swiss 只接收店員確認的名單 snapshot。
- 使用 C 方案：短效、一次性、可撤銷 handoff document；只允許特定管理員/服務讀取，設到期時間與消費狀態。
- 不把姓名、電話、Honor ID 放入 URL。
- B1 metadata schema 維持 v1；B2 另用 `registrationHandoff` schema，不污染 B1 payload。
- `calendarEventId` 仍是來源 reference，`tournamentId` 仍由 Swiss 產生，`registrationId` 不取代兩者。

# 12. B1–B5 路線圖

| 階段 | 目標 | 主要 repository | Functions | Rules | 回滾界線 |
|---|---|---|---|---|---|
| B1 | Calendar metadata → Swiss 空白賽事 | Calendar + Swiss | 不需要 | 不需要 | 關閉按鈕/移除 handoff parser；既有手動建賽仍可用 |
| B2 | 預報名名單受控交接 | Calendar + Swiss；可能獨立 handoff backend | 需要 | 需要 | 停止新 handoff；既有報名與賽事各自保留 |
| B3 | Swiss → Honor 匯入 UX 改善 | Swiss + Honor | 視方案；優先不新增 | 通常不需 | 保留 JSON v2 手動檔案匯入作 fallback |
| B4 | Calendar/Catalog → n8n 唯讀自動化 | Calendar/Catalog + n8n config | 可能用唯讀 API | 可能需要 service boundary | 停用 workflow，不影響來源資料 |
| B5 | POS/Odoo/庫存/榮耀/收購交易串接 | POS/Odoo + Honor + Catalog/Buyback | 必須 | 必須 | 功能旗標、冪等 operation、對帳與補償流程；不可雙主寫入 |

B3 原則：即使未來改成直接上傳/Callable，仍保留 JSON v2、preview、玩家對應、人工確認、tournamentId 冪等與 transaction；不做自動發獎。

# 13. 安全、隱私與回滾

- B1 payload 無玩家名單、姓名、電話、Honor ID、UID、牌組或報名資訊。
- handoff URL 不含 token/secret；仍不應寫入 analytics 自訂事件或 server logs 的完整 query。
- Calendar/Swiss 都只接受固定 production/preview origin allowlist；`postMessage` 禁止 `*`。
- 所有 schema exact-key、版本化、大小限制、型別限制；錯誤只顯示公開 validation code。
- Calendar event link 寫入僅由已登入且 Rules 認可的管理員執行；前端 allowlist 只控制 UI。
- 手動建賽、QR 報名、localStorage、cloud sync、JSON v2 匯出必須保持可獨立使用。
- B1 前端回滾不需改資料：隱藏 Calendar 按鈕、Swiss 停止解析 handoff；已建立 tournament 與 event link 不刪除。
- B2 以上涉及 PII 時不得用 URL；B5 涉及金流/庫存時必須有 requestId、payload fingerprint、transaction、audit、補償與人工對帳。
- n8n、GAS、LINE OA 只能取得完成任務所需的最小欄位；不持有核心系統寫入權限。

# 14. 待產品確認問題

1. B1 是否要求不同 Swiss 管理員 UID 也能直接開啟同一賽事？若是，B1 需改採 C 方案並新增 backend index。
2. B1 已決定 payload 使用 `suggestedTopCut` 作規劃提示；實際 `topCut` 在建立時保持 0。
3. B1 已新增純整數 `entryFee`；既有 `fee` 保留為公告文字，舊活動缺值時由店員在 Swiss 確認頁補填。
4. B1 已正式保存 `gameCode`, `capacity`, `suggestedRounds`, `suggestedTopCut`；不從顯示文字猜測數值。
5. Calendar 活動修改後，第一輪開始前是否允許人工更新 Swiss metadata？建議允許；第一輪後禁止。
6. Swiss tournament 被刪除或換管理員帳號不可見時，誰可解除 Calendar link？建議只允許管理員明確 unlink，並保留時間/操作者欄位。
7. Calendar 活動刪除後，是否保留 tombstone/reference 供 Swiss 顯示來源已刪除？B1 可先不做，但不能 cascade delete。
8. Swiss production canonical URL 固定為 `swiss-tournament-one.vercel.app`；Preview 仍須在兩個 Vercel project 設定固定 branch alias 的精確 origin allowlist。
9. B2 預報名是否由 Calendar 承擔，或另有 Forms/專用服務？在責任確定前不要複製第二份名單。
10. Odoo POS 與「未來 POS」何者是唯一訂單/付款/庫存權威？未決前禁止 B5 雙向同步。
11. n8n 的實際 hosting、service identity、讀取來源、排程與錯誤通知目前不在 repo，B4 前需另行盤點。
12. 行事曆官方獎勵圖文若賽後修改，是否需要版本快照供爭議查核？目前沒有版本化公告契約。

# 15. B1 預計 repository 與最小檔案範圍

## 行事曆 repository

預計修改：

- `src/App.jsx`：管理員活動欄位、建立/已連結按鈕、origin-checked `postMessage`、回寫 link metadata。
- 新增 `src/utils/swissHandoff.js`：gameCode adapter、strict payload builder、base64url encode、message validator。
- 新增 `tests/swissHandoff.test.js`：schema、URL 長度、未知欄位、callback origin、重複 link。

不預計修改：

- `firestore.rules`：既有管理員可更新 `monster_tournaments`，B1 不新增 public write。
- Firebase project/data root、預約、GAS、型錄共用 Rules。

## 瑞士制 repository

預計修改：

- `src/App.jsx`：偵測 handoff、顯示確認、查重、create/open existing、postMessage 結果。
- `src/utils/integrationContracts.js`：沿用 Calendar → Swiss v1 validator/normalizer，不另建第二份 schema。
- `src/utils/tournamentMetadata.js`：沿用 `createTournamentFromInput()` 與 `calendarEventId`；必要時加入 `plannedTopCut` adapter。
- 新增 `src/utils/calendarHandoff.js`：URL decode、大小限制、origin/duplicate helpers。
- 新增 `src/components/CalendarHandoffDialog.jsx`：確認與差異畫面。
- 新增/更新 `tests/integrationContracts.test.js`, `tests/tournamentMetadata.test.js`, `tests/calendarHandoff.test.js`。

不預計修改：

- `firestore.rules`、QR registration paths、cloud sync ownership、JSON v2 schema、配對/排名公式。

## 不涉及的 repositories

- 榮耀、獎勵計算、型錄、收購、文案、營收、POS/Odoo、n8n：B1 零程式修改。

## B1 驗收門檻

- Calendar payload validator / Swiss parser 全測試通過。
- 人工確認前不建立 tournament。
- 同 calendarEventId 重送不產生第二個 tournamentId。
- first round 後不覆寫 metadata。
- localStorage、cloud current/history、QR、JSON v2、配對、排名、tombstone 既有測試不回歸。
- Calendar/Swiss 可各自關閉整合功能，手動流程仍完整。

---

## Git 狀態快照（2026-08-01）

| Repository | 狀態 |
|---|---|
| 榮耀 `C:\Users\文毅\Desktop\zaocard-system` | `main...origin/main [behind 2]`; `M .gitignore`; `?? SYSTEM_FACTS.md`; `?? 一鍵召喚榮耀系統工班.bat`。`origin/main=707df9a9...`，本次未操作。 |
| 瑞士制 `...\賽事配對工具-git推送自動部署` | `feat/integration-ready-tournament-metadata`; `?? SWISS_SYSTEM_FACTS.md`; stash `wip-p3-ranking-explanation` 保持。 |
| 行事曆 `...\賽事行事曆-git推送自動部署` | `main...origin/main`; `?? CALENDAR_SYSTEM_FACTS.md`。 |
| 獎勵工具 `...\賽事獎勵計算-git推送自動部署` | `main...origin/main`; clean。 |
| 型錄 `...\線上型錄-git推送自動部署` | `main...origin/main`; clean。 |
| 收購 `...\卡片收購系統-VercelCLI手動部署` | `main...origin/main [behind 2]`; `M .gitignore`。`origin/main=56f98c09...`，本次未操作。 |
| 文案生成器 `...\文案生成器-git推送自動部署` | `main...origin/main`; `M .gitignore`。 |
| 營收 Apps Script `...\營收試算表-AppsScript` | 不是 Git repository。 |
