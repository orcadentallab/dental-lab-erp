# دليل إعداد السيرفر (Supabase Setup Guide)

بما إننا لسه معملناش سيرفر، محتاجين ننشئ واحد مجاني على موقع **Supabase**. ده هيكون هو "قاعدة البيانات" و "نظام الدخول".

إمشي ورا الخطوات دي بالترتيب:

## 1. إنشاء المشروع (Create Project)
1.  ادخلي على موقع [supabase.com](https://supabase.com) واعملي حساب (Sign In).
2.  اضغطي على **New Project**.
3.  اختاري **Organization** (لو مفيش اعملي واحدة جديدة).
4.  املئي البيانات:
    *   **Name**: `Dental Lab ERP` (أو أي اسم تحبيه).
    *   **Database Password**: اكتبي باسورد قوية **واحفظيها كويس جداً**.
    *   **Region**: اختاري أقرب مكان (مثلاً Frankfurt).
5.  اضغطي **Create new project**. استني دقيقتين لحد ما يخلص (هيكتبلك Setting up...).

## 2. ربط المشروع بالكود (Connect)
1.  لما المشروع يفتح، انزلي تحت شوية هتلاقي **Project API**.
    *   انسخي **Project URL**.
    *   انسخي **API Key** (اللي مكتوب جنبه `anon` `public`).
2.  ارجعي لملفات المشروع عندك على الكمبيوتر.
3.  اعملي ملف جديد اسمه `.env` (جنب ملف `package.json`).
4.  اكتبي جواه السطرين دول (وبدلي الأصفار بالبيانات اللي نسختيها):

```env
VITE_SUPABASE_URL=https://your-project-url.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**مهم:** لازم تعملي **Restart** للبرنامج (`Ctrl+C` وبعدين `npm run dev`) عشان يقرا الملف الجديد.

## 3. بناء قاعدة البيانات (Database Setup)
دلوقتي السيرفر فاضي، لازم نبني الجداول.

1.  في موقع Supabase، اختاري **SQL Editor** من القائمة الجانبية.
2.  اضغطي **New Query**.
3.  هنعمل 3 خطوات (انسخي الكود زي ما هو):

### أ. الجداول الأساسية (Basic Tables)
انسخي محتوى الملف `supabase/migrations/001_initial_schema.sql` وحطيه في الـ SQL Editor واضغطي **Run**.

### ب. الأمان والصلاحيات (Security)
امسحي القديم، وانسخي محتوى الملف `supabase/migrations/002_rls_security.sql` واضغطي **Run**.

### ج. تسجيل الدخول باسم المستخدم (Username Login)
امسحي القديم، وانسخي محتوى الملف `supabase/migrations/003_username_login.sql` واضغطي **Run**.

## 4. إنشاء أول مستخدم (Admin User)
عشان تدخلي أول مرة:

1.  روحي لقائمة **Authentication** في Supabase.
2.  اضغطي **Add User**.
3.  اكتبي إيميل (مثلاً `admin@lab.com`) وباسورد. واضغطي **Create User**.
4.  **أهم خطوة:** روحي لقائمة **Table Editor** وافتحي جدول `users`.
5.  هتلاقي الجدول فاضي (أو ممكن تلاقي سطر لو حاولت تدخلي).
    *   اضغطي **Insert New Row**.
    *   `username`: `admin`
    *   `role`: `admin`
    *   `email`: `admin@lab.com` (نفس الإيميل اللي عملتيه فوق).
    *   `auth_id`: هاتي الـ **User UID** من قائمة Authentication وحطيه هنا.
6.  اضغطي **Save**.

## مبروك!
دلوقتي تقدري تفتحي الموقع وتكتبي في اسم المستخدم: `admin` والباسورد اللي اخترتيها، وهيدخل معاكي تمام.
