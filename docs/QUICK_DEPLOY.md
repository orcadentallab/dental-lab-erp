# ⚡ نشر سريع - الطريقة المعتمدة للمشروع

## ✅ الطريقة الحالية التي نجحت

هذا المشروع يعمل بـ **Auto Deploy** بعد الـ push على GitHub.

الخطوات المعتمدة:

```bash
npm run build
git add .
git commit -m "Your changes"
git push origin HEAD
```

بعد الـ `push` يبدأ النشر الأونلاين تلقائيًا.

---

## 🖱️ أسرع طريقة من الجهاز

يمكن تشغيل أحد الملفات الجاهزة:

- `CLICK_TO_DEPLOY.bat`
- `run-deploy.ps1`
- `deploy.ps1`

### ماذا يفعل `deploy.ps1`؟

1. يشغّل `npm run build`
2. يعمل `git add .`
3. يطلب منك `commit message`
4. يعمل `git push origin HEAD`
5. وبذلك يبدأ الـ auto-deploy

---

## 📌 ملاحظات مهمة

- البرانش المستخدم حاليًا: `master`
- الريموت المستخدم: `origin`
- لو الـ build فشل، لا يتم النشر
- لو لا يوجد تغييرات جديدة، يمكن دفع آخر برانش فقط

---

## 🔄 تحديث البرنامج لاحقًا

في أي مرة قادمة:

```bash
npm run build
git add .
git commit -m "Update"
git push origin HEAD
```

أو ببساطة شغّل:

```powershell
.\deploy.ps1
```

---

**تفاصيل أكثر:** راجع [DEPLOYMENT_GUIDE_AR.md](D:\dental-lab-erp\docs\DEPLOYMENT_GUIDE_AR.md)
