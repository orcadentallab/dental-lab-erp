# ⚡ نشر سريع - خطوات مختصرة

## 🚀 النشر على Vercel (5 دقائق)

### 1. رفع الكود على GitHub
```bash
git init
git add .
git commit -m "Ready for deployment"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. النشر على Vercel
1. اذهب إلى [vercel.com/new](https://vercel.com/new)
2. سجل دخول بحساب GitHub
3. Import مشروعك
4. **أضف Environment Variables:**
   - `VITE_SUPABASE_URL` = من Supabase → Settings → API → Project URL
   - `VITE_SUPABASE_ANON_KEY` = من Supabase → Settings → API → anon public
5. اضغط Deploy

### 3. جاهز! 🎉
- الرابط: `your-app.vercel.app`
- يعمل من أي جهاز (موبايل، لابتوب)
- البيانات محفوظة في Supabase

---

## 📱 الوصول من الموبايل

1. افتح المتصفح على الموبايل
2. اكتب الرابط
3. (اختياري) Add to Home Screen

---

## 🔄 تحديث البرنامج

```bash
git add .
git commit -m "Your changes"
git push
```
→ Vercel ينشر تلقائياً!

---

**المزيد من التفاصيل:** راجع `DEPLOYMENT_GUIDE_AR.md`
