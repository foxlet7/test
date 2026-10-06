import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { messages as shared, type Locale } from '@tablya/shared';

const admin: Record<Locale, Record<string, string>> = {
  en: {
    'nav.dashboard': 'Dashboard', 'nav.kitchens': 'Kitchens', 'nav.orders': 'Orders', 'nav.users': 'Users', 'nav.moderation': 'Moderation',
    'nav.payments': 'Payments & refunds', 'nav.marketing': 'Coupons & promos', 'nav.catalog': 'Categories', 'nav.support': 'Support',
    'nav.settings': 'Settings', 'nav.audit': 'Audit log', 'nav.logout': 'Log out', 'nav.language': 'العربية',
    'login.title': 'Tablya Admin', 'login.totp': 'Authenticator code', 'login.totpHint': '6-digit code from your authenticator app', 'login.staffOnly': 'This console is for staff accounts only.',
    'login.setupMfa': 'Two-factor authentication is required. Sign in once from the API or ask a super admin to enrol you.',
    'dash.users': 'Active users', 'dash.customers': 'Active customers (30d)', 'dash.kitchens': 'Verified kitchens', 'dash.pending': 'Pending verification',
    'dash.orders': 'Orders (30d)', 'dash.gmv': 'Order value (30d)', 'dash.revenue': 'Platform revenue (30d)', 'dash.refunds': 'Refunds (30d)',
    'dash.reports': 'Open reports', 'dash.tickets': 'Open tickets', 'dash.rating': 'Average rating', 'dash.pendingRefunds': 'Refunds pending',
    'dash.system': 'System health', 'dash.db': 'Database', 'dash.webhooks': 'Webhook problems (7d)', 'dash.byStatus': 'Orders by status', 'dash.daily': 'Last 14 days',
    'col.name': 'Name', 'col.email': 'Email', 'col.status': 'Status', 'col.roles': 'Roles', 'col.created': 'Created', 'col.owner': 'Owner', 'col.city': 'City',
    'col.total': 'Total', 'col.customer': 'Customer', 'col.kitchen': 'Kitchen', 'col.order': 'Order', 'col.payment': 'Payment', 'col.amount': 'Amount',
    'col.reason': 'Reason', 'col.target': 'Target', 'col.rating': 'Rating', 'col.text': 'Text', 'col.code': 'Code', 'col.value': 'Value', 'col.used': 'Used',
    'col.actor': 'Actor', 'col.action': 'Action', 'col.entity': 'Entity', 'col.when': 'When', 'col.actions': 'Actions', 'col.subject': 'Subject',
    'act.approve': 'Approve', 'act.reject': 'Reject', 'act.review': 'Start review', 'act.suspend': 'Suspend', 'act.reinstate': 'Reinstate', 'act.refund': 'Refund',
    'act.hide': 'Hide', 'act.show': 'Show', 'act.dismiss': 'Dismiss', 'act.view': 'View', 'act.create': 'Create', 'act.activate': 'Activate', 'act.deactivate': 'Deactivate',
    'act.reply': 'Reply', 'act.close': 'Close', 'act.confirm': 'Confirm', 'act.cancel': 'Cancel', 'act.retry': 'Retry', 'act.next': 'Next', 'act.prev': 'Previous', 'act.save': 'Save',
    'act.override': 'Move to…', 'act.viewDoc': 'View document',
    'dlg.reasonLabel': 'Reason (required, recorded in the audit log)', 'dlg.reasonShort': 'Please enter a reason of at least 3 characters.',
    'state.loading': 'Loading…', 'state.empty': 'Nothing to show.', 'state.error': 'Could not load this data.', 'state.offline': 'No connection to the server.',
    'filter.search': 'Search', 'filter.all': 'All', 'filter.status': 'Status',
    'settings.tax': 'VAT / tax (basis points)', 'settings.service': 'Service fee (basis points)', 'settings.commission': 'Default commission (basis points)', 'settings.superOnly': 'Only super admins can change platform settings.',
    'settings.saved': 'Settings saved.', 'cat.slug': 'Slug', 'cat.nameAr': 'Arabic name', 'coupon.type': 'Type', 'coupon.percent': 'Percent', 'coupon.fixed': 'Fixed',
    'order.history': 'History', 'order.items': 'Items', 'order.ledger': 'Ledger', 'order.refunds': 'Refunds', 'order.payments': 'Payments',
    'kitchen.documents': 'Verification documents', 'kitchen.docsAudited': 'Opening a document is recorded in the audit log.',
    'mod.reports': 'Reports', 'mod.reviews': 'Reviews', 'support.reply': 'Reply to customer',
    'toast.done': 'Done.', 'toast.failed': 'Action failed.',
  },
  ar: {
    'nav.dashboard': 'لوحة التحكم', 'nav.kitchens': 'المطابخ', 'nav.orders': 'الطلبات', 'nav.users': 'المستخدمون', 'nav.moderation': 'الإشراف',
    'nav.payments': 'المدفوعات والمستردات', 'nav.marketing': 'الكوبونات والعروض', 'nav.catalog': 'التصنيفات', 'nav.support': 'الدعم',
    'nav.settings': 'الإعدادات', 'nav.audit': 'سجل التدقيق', 'nav.logout': 'تسجيل الخروج', 'nav.language': 'English',
    'login.title': 'إدارة طاولية', 'login.totp': 'رمز المصادقة', 'login.totpHint': 'رمز من 6 أرقام من تطبيق المصادقة', 'login.staffOnly': 'هذه اللوحة لحسابات الموظفين فقط.',
    'login.setupMfa': 'المصادقة الثنائية مطلوبة. اطلب من المشرف الأعلى تفعيلها لحسابك.',
    'dash.users': 'المستخدمون النشطون', 'dash.customers': 'العملاء النشطون (30 يومًا)', 'dash.kitchens': 'المطابخ الموثقة', 'dash.pending': 'بانتظار التوثيق',
    'dash.orders': 'الطلبات (30 يومًا)', 'dash.gmv': 'قيمة الطلبات (30 يومًا)', 'dash.revenue': 'إيرادات المنصة (30 يومًا)', 'dash.refunds': 'المستردات (30 يومًا)',
    'dash.reports': 'البلاغات المفتوحة', 'dash.tickets': 'تذاكر الدعم المفتوحة', 'dash.rating': 'متوسط التقييم', 'dash.pendingRefunds': 'مستردات قيد المعالجة',
    'dash.system': 'حالة النظام', 'dash.db': 'قاعدة البيانات', 'dash.webhooks': 'مشاكل الويب هوك (7 أيام)', 'dash.byStatus': 'الطلبات حسب الحالة', 'dash.daily': 'آخر 14 يومًا',
    'col.name': 'الاسم', 'col.email': 'البريد', 'col.status': 'الحالة', 'col.roles': 'الأدوار', 'col.created': 'أُنشئ', 'col.owner': 'المالك', 'col.city': 'المدينة',
    'col.total': 'الإجمالي', 'col.customer': 'العميل', 'col.kitchen': 'المطبخ', 'col.order': 'الطلب', 'col.payment': 'الدفع', 'col.amount': 'المبلغ',
    'col.reason': 'السبب', 'col.target': 'الهدف', 'col.rating': 'التقييم', 'col.text': 'النص', 'col.code': 'الرمز', 'col.value': 'القيمة', 'col.used': 'المستخدم',
    'col.actor': 'المنفّذ', 'col.action': 'الإجراء', 'col.entity': 'الكيان', 'col.when': 'الوقت', 'col.actions': 'إجراءات', 'col.subject': 'الموضوع',
    'act.approve': 'اعتماد', 'act.reject': 'رفض', 'act.review': 'بدء المراجعة', 'act.suspend': 'إيقاف', 'act.reinstate': 'إعادة تفعيل', 'act.refund': 'استرداد',
    'act.hide': 'إخفاء', 'act.show': 'إظهار', 'act.dismiss': 'تجاهل', 'act.view': 'عرض', 'act.create': 'إنشاء', 'act.activate': 'تفعيل', 'act.deactivate': 'تعطيل',
    'act.reply': 'رد', 'act.close': 'إغلاق', 'act.confirm': 'تأكيد', 'act.cancel': 'إلغاء', 'act.retry': 'إعادة المحاولة', 'act.next': 'التالي', 'act.prev': 'السابق', 'act.save': 'حفظ',
    'act.override': 'نقل إلى…', 'act.viewDoc': 'عرض المستند',
    'dlg.reasonLabel': 'السبب (مطلوب ويُسجل في سجل التدقيق)', 'dlg.reasonShort': 'أدخل سببًا لا يقل عن 3 أحرف.',
    'state.loading': 'جارٍ التحميل…', 'state.empty': 'لا يوجد شيء لعرضه.', 'state.error': 'تعذر تحميل البيانات.', 'state.offline': 'لا يوجد اتصال بالخادم.',
    'filter.search': 'بحث', 'filter.all': 'الكل', 'filter.status': 'الحالة',
    'settings.tax': 'ضريبة القيمة المضافة (نقاط أساس)', 'settings.service': 'رسوم الخدمة (نقاط أساس)', 'settings.commission': 'العمولة الافتراضية (نقاط أساس)', 'settings.superOnly': 'يمكن للمشرف الأعلى فقط تغيير إعدادات المنصة.',
    'settings.saved': 'تم حفظ الإعدادات.', 'cat.slug': 'المعرّف', 'cat.nameAr': 'الاسم بالعربية', 'coupon.type': 'النوع', 'coupon.percent': 'نسبة', 'coupon.fixed': 'مبلغ ثابت',
    'order.history': 'السجل', 'order.items': 'العناصر', 'order.ledger': 'دفتر الحسابات', 'order.refunds': 'المستردات', 'order.payments': 'المدفوعات',
    'kitchen.documents': 'مستندات التوثيق', 'kitchen.docsAudited': 'فتح المستند يُسجل في سجل التدقيق.',
    'mod.reports': 'البلاغات', 'mod.reviews': 'التقييمات', 'support.reply': 'الرد على العميل',
    'toast.done': 'تم.', 'toast.failed': 'فشل الإجراء.',
  },
};

interface I18n {
  locale: Locale;
  setLocale(l: Locale): void;
  t(key: string, vars?: Record<string, string | number>): string;
  money(minor: number, currency?: string): string;
  date(d: string | Date): string;
}
const Ctx = createContext<I18n>(null as unknown as I18n);
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      return localStorage.getItem('tablya.admin.locale') === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale(l) {
        setLocaleState(l);
        try {
          localStorage.setItem('tablya.admin.locale', l);
        } catch {
          /* ignore */
        }
      },
      t: (key, vars) => {
        const raw = admin[locale][key] ?? shared[locale][key] ?? admin.en[key] ?? key;
        return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : raw;
      },
      money: (minor, currency = 'SAR') => new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', { style: 'currency', currency }).format(minor / 100),
      date: (d) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)),
    }),
    [locale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
