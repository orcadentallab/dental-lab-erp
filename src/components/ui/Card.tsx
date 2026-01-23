
import { motion, type HTMLMotionProps } from 'framer-motion';
import { twMerge } from 'tailwind-merge';

interface CardProps extends HTMLMotionProps<"div"> {
    variant?: 'default' | 'glass' | 'plain';
}

export function Card({ className, variant = 'default', children, ...props }: CardProps) {
    const baseStyles = 'rounded-2xl p-6 transition-all';

    const variants = {
        default: 'bg-white shadow-sm border border-surface-100',
        glass: 'glass-card',
        plain: 'bg-surface-50 border border-t-white/50',
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className={twMerge(baseStyles, variants[variant], className)}
            {...props}
        >
            {children}
        </motion.div>
    );
}
