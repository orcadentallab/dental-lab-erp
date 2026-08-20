import {
    getIssueCauseOptions,
    getStageForCause,
    RESPONSIBLE_STAGE,
    type IssueContext,
    type ResponsibleStage,
} from '../../constants/issueCauses';

interface Props {
    issueContext: IssueContext;
    causeCategory: string;
    onCauseCategoryChange: (code: string) => void;
    responsibleStage: string;
    onResponsibleStageChange: (stage: string) => void;
    notes: string;
    onNotesChange: (notes: string) => void;
    notesPlaceholder?: string;
    /** Suggested responsible_stage choices offered in the stage select, per context. */
    stageOptions?: ResponsibleStage[];
}

const DEFAULT_STAGE_OPTIONS_BY_CONTEXT: Record<IssueContext, ResponsibleStage[]> = {
    lab_rejection: ['doctor'],
    cancellation: ['doctor'],
    post_delivery: ['external_lab', 'logistics'],
};

/**
 * Explicit cause/stage/notes fields shared by every action that logs an
 * order_issues row (lab rejection, cancellation, doctor rejection, return
 * for adjustment, redo). Replaces the old free-text-only "reason" box so the
 * reason is picked from a vocabulary specific to what actually happened,
 * instead of guessed later from whatever the note happens to say.
 *
 * The cause list shown depends on issueContext — see
 * src/constants/issueCauses.ts for why lab-rejection / cancellation /
 * post-delivery causes are three separate vocabularies, not one.
 */
export default function IssueCauseFields({
    issueContext,
    causeCategory,
    onCauseCategoryChange,
    responsibleStage,
    onResponsibleStageChange,
    notes,
    onNotesChange,
    notesPlaceholder,
    stageOptions,
}: Props) {
    const causeOptions = getIssueCauseOptions(issueContext);
    const stageChoices = stageOptions || DEFAULT_STAGE_OPTIONS_BY_CONTEXT[issueContext];

    const handleCauseChange = (code: string) => {
        onCauseCategoryChange(code);
        onResponsibleStageChange(getStageForCause(issueContext, code));
    };

    return (
        <div className="space-y-3 text-right">
            <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                    السبب <span className="text-red-500">*</span>
                </label>
                <select
                    autoFocus
                    value={causeCategory}
                    onChange={(e) => handleCauseChange(e.target.value)}
                    className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400 text-right bg-white"
                >
                    <option value="" disabled>اختر السبب…</option>
                    {causeOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                    المرحلة المسؤولة
                </label>
                <select
                    value={responsibleStage}
                    onChange={(e) => onResponsibleStageChange(e.target.value)}
                    className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400 text-right bg-white"
                >
                    {stageChoices.map((stage) => (
                        <option key={stage} value={stage}>
                            {RESPONSIBLE_STAGE[stage]}
                        </option>
                    ))}
                </select>
                <p className="mt-1 text-xs text-surface-500">
                    مقترحة تلقائياً حسب السبب المختار، وقابلة للتعديل.
                </p>
            </div>

            <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                    ملاحظات <span className="text-surface-400 font-normal">(اختياري)</span>
                </label>
                <textarea
                    rows={2}
                    placeholder={notesPlaceholder || 'تفاصيل إضافية…'}
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none text-right"
                />
            </div>
        </div>
    );
}
