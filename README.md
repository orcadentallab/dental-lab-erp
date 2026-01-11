# 🦷 نظام إدارة معمل الأسنان (Dental Lab ERP)

نظام شامل لإدارة معامل الأسنان يتيح إدارة الطلبات والأطباء والموردين والماليات والمستخدمين.

## ✨ المميزات

- ✅ إدارة كاملة للطلبات (Orders Management)
- ✅ إدارة الأطباء والعملاء (Doctors Management)
- ✅ إدارة الموردين (Suppliers Management)
- ✅ إدارة المعاملات المالية (Finance Management)
- ✅ إدارة المستخدمين والصلاحيات (Users & Roles)
- ✅ لوحة تحكم مع إحصائيات (Dashboard)
- ✅ واجهة عربية كاملة (RTL Support)
- ✅ تصميم متجاوب (Responsive) - يعمل على الموبايل واللابتوب

## 🚀 النشر أونلاين

لنشر البرنامج على الإنترنت واستخدامه من أي جهاز:

1. **راجع:** [دليل النشر الكامل](./DEPLOYMENT_GUIDE_AR.md) (عربي)
2. **للنشر السريع:** [دليل النشر السريع](./QUICK_DEPLOY.md) (عربي)

## 📦 التثبيت والتشغيل

```bash
# تثبيت المكتبات
npm install

# تشغيل البرنامج محلياً
npm run dev

# بناء البرنامج للإنتاج
npm run build
```

## 🔐 الإعداد

1. أنشئ ملف `.env` في جذر المشروع:
```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

2. راجع: [دليل الإعداد](./SETUP_GUIDE.md) (عربي)

## 🛠️ التقنيات المستخدمة

- **Frontend:** React 19 + TypeScript + Vite
- **Styling:** Tailwind CSS
- **Database & Auth:** Supabase
- **Validation:** Zod
- **Routing:** React Router v7

## 📚 التوثيق

- [دليل الإعداد](./SETUP_GUIDE.md)
- [دليل النشر](./DEPLOYMENT_GUIDE_AR.md)
- [مراجعة المشروع](./PROJECT_REVIEW_AR.md)
- [التحسينات الأمنية](./SECURITY_IMPROVEMENTS.md)

## 📝 ملاحظات

- البيانات محفوظة في Supabase (سحابي)
- الوصول من أي جهاز (موبايل، لابتوب)
- نسخ احتياطي تلقائي
- أمان عالي مع RLS Policies

## 🤝 المساهمة

هذا مشروع مفتوح المصدر. مرحب بأي مساهمات!

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
