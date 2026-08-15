import { useEffect } from 'react';
import MarketingLayout from './layout/MarketingLayout';
import HeroSection from './components/HeroSection';
import ServicesSection from './components/ServicesSection';
import FAQSection from './components/FAQSection';
import PortfolioSection from './components/PortfolioSection';
import PricingSection from './components/PricingSection';
import ContactSection from './components/ContactSection';
import { marketingService } from '../services/supabase/marketingService';
import { getMarketingClickEvents } from './marketingClickTracking';

export default function MarketingPage() {
    useEffect(() => {
        document.title = 'ORCA Dental Lab | Premium Dental Restorations';

        const setMetaTag = (attrName: string, attrValue: string, content: string) => {
            let meta = document.querySelector(`meta[${attrName}="${attrValue}"]`);
            if (!meta) {
                meta = document.createElement('meta');
                meta.setAttribute(attrName, attrValue);
                document.head.appendChild(meta);
            }
            meta.setAttribute('content', content);
        };

        setMetaTag('name', 'description', 'ORCA Dental Lab provides world-class dental restorations. Elevate your practice with our premium quality and transparent value.');
        setMetaTag('property', 'og:title', 'ORCA Dental Lab | Premium Dental Restorations');
        setMetaTag('property', 'og:description', 'ORCA Dental Lab provides world-class dental restorations. Elevate your practice with our premium quality.');
        setMetaTag('property', 'og:type', 'website');
        setMetaTag('property', 'og:url', window.location.href);
        setMetaTag('property', 'og:image', '/orca-logo.png');

        const deviceType = window.innerWidth < 768 ? 'mobile' : 'desktop';
        const sessionId = sessionStorage.getItem('mkt_session') || `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem('mkt_session', sessionId);

        // Track WhatsApp clicks (all wa.me links on the page)
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            getMarketingClickEvents(target).forEach((eventName) => {
                marketingService.logEvent({
                    event_name: eventName,
                    source: eventName === 'pricing_cta_click' ? 'pricing_section' : 'marketing_landing',
                    page_type: 'marketing_landing',
                    device_type: deviceType,
                    session_id: sessionId,
                });
            });
        };
        document.addEventListener('click', handleClick);

        // Track engaged session (scroll 50% OR 30 seconds on page — whichever first)
        let engagedLogged = false;
        const logEngaged = (source: string) => {
            if (engagedLogged) return;
            engagedLogged = true;
            marketingService.logEvent({
                event_name: 'engaged_session',
                source,
                page_type: 'marketing_landing',
                device_type: deviceType,
                session_id: sessionId,
            });
        };

        const handleScroll = () => {
            const scrollPercent = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
            if (scrollPercent > 0.5) logEngaged('scroll_50');
        };
        window.addEventListener('scroll', handleScroll, { passive: true });

        const engagedTimer = setTimeout(() => logEngaged('time_30s'), 30000);

        return () => {
            document.removeEventListener('click', handleClick);
            window.removeEventListener('scroll', handleScroll);
            clearTimeout(engagedTimer);
        };
    }, []);

    return (
        <MarketingLayout>
            <HeroSection />
            <ServicesSection />
            <PortfolioSection />
            <PricingSection />
            <FAQSection />
            <ContactSection />
        </MarketingLayout>
    );
}
