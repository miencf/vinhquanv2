# Hướng Dẫn Cấu Hình & Chuyển Đổi Rules Firebase Sang Production

Tệp cấu hình Firebase đã được cập nhật sang dự án **`vinhquannv`** kèm đường dẫn Realtime Database:
- **Project ID**: `vinhquannv`
- **Realtime Database**: `https://vinhquannv-default-rtdb.asia-southeast1.firebasedatabase.app/`

---

## 1. Cloud Firestore Rules (Tệp `firestore.rules`)

Trong chế độ Production, catch-all `allow read, write: if true;` đã được thay thế bằng quy tắc phân quyền theo từng collection cụ thể, kèm kiểm tra ràng buộc trường dữ liệu bắt buộc (Data Validation):
- `employees`: Kiểm tra đủ trường `name`, `role`, `hourlyRate` (&ge; 0).
- `attendance`: Kiểm tra `employeeId`, `date`, và `status` thuộc `['present', 'late', 'absent']`.
- `adjustments`: Kiểm tra `amount` (&ge; 0), `type` thuộc `['bonus', 'penalty']`, `reason`.
- `shifts`: Kiểm tra `name`, `multiplier`.
- `settings`: Cho phép đọc ghi cài đặt `gps` và `shift_policy`.
- `activities`: Audit log hệ thống.
- `gratitude_wall`, `music_tracks`, `dismissed_auto_bonuses`.
- **Mọi collection hoặc đường dẫn khác không được khai báo đều bị CHẶN HOÀN TOÀN** (`match /{document=**} { allow read, write: if false; }`).

### Cách dán vào Firebase Console:
1. Vào **Firebase Console** &rarr; Chọn dự án **vinhquannv**.
2. Chọn **Build** &rarr; **Firestore Database** &rarr; Tab **Rules** (Quy tắc).
3. Sao chép toàn bộ nội dung từ tệp `firestore.rules` và dán vào.
4. Nhấn **Publish** (Xuất bản).

---

## 2. Realtime Database Rules (Tệp `database.rules.json`)

Trong Realtime Database, quy tắc Production đóng quyền truy cập toàn bộ root (`".read": false, ".write": false`) và chỉ mở cho các node chức năng cần thiết:
- `/presence/$employeeId`: Trạng thái online/offline của nhân viên có kiểm tra cấu trúc `status` và `lastSeen`.
- `/attendance_realtime`: Nhật ký chấm công tức thì.
- `/notifications`: Thông báo hệ thống.
- `/shifts_status`: Trạng thái ca làm việc.
- `/settings`: Cấu hình chung.

### Cách dán vào Firebase Console:
1. Vào **Firebase Console** &rarr; Chọn dự án **vinhquannv**.
2. Chọn **Build** &rarr; **Realtime Database** &rarr; Tab **Rules** (Quy tắc).
3. Sao chép toàn bộ nội dung từ tệp `database.rules.json` và dán vào.
4. Nhấn **Publish** (Xuất bản).
