-- Thong bao nguy co tre han khong con noi muc (user chot 30/10, RISK_MODULE.md §8.3): "notifiedLevel" nay la MOC DA BAO -
-- WARNING = da bao "co nguy co tre han", CRITICAL = da bao "da tre han". The CHUA qua han ma truoc day da bao muc Nguy cap
-- chuyen ve WARNING (coi la moi bao nguy co), de khi the qua han van nhan duoc thong bao "da tre han". Khong doi cau truc bang.
UPDATE "CardRisk" SET "notifiedLevel" = 'WARNING' WHERE "notifiedLevel" = 'CRITICAL' AND "dueDateUsed" > NOW();
