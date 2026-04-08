

export default function InboxView() {
  return (
    <>

<div className="flex h-screen w-full">
{/* Sidebar Navigation (SideNavBar Component Mapping) */}
<aside className="bg-zinc-100/70 dark:bg-zinc-900/70 backdrop-blur-2xl h-screen w-64 flex flex-col fixed left-0 top-0 p-4 space-y-2 z-40 transition-all">
<div className="mb-6 px-3 flex items-center gap-3">
<div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xs">
                    EM
                </div>
<div className="flex flex-col">
<span className="text-sm font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">Essentialist Mail</span>
<span className="font-inter text-[11px] tracking-wide text-zinc-500">user@essentialist.com</span>
</div>
</div>
<button className="mb-6 w-full py-2.5 px-4 bg-gradient-to-r from-primary to-primary-container text-white rounded-xl shadow-lg shadow-primary/10 flex items-center justify-center gap-2 font-medium text-sm hover:opacity-90 active:scale-[0.98] transition-all">
<span className="material-symbols-outlined text-[20px]">edit</span>
                Compose
            </button>
<nav className="flex flex-col space-y-1">
<div className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 font-semibold rounded-lg relative before:content-[''] before:absolute before:left-[-12px] before:w-1 before:h-5 before:bg-blue-600 before:rounded-full py-2 px-3 flex items-center gap-3">
<span className="material-symbols-outlined" data-icon="inbox">inbox</span>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Inbox</span>
<span className="ml-auto text-[11px] bg-blue-200 dark:bg-blue-800 px-1.5 py-0.5 rounded-md">12</span>
</div>
<div className="text-zinc-600 dark:text-zinc-400 py-2 px-3 flex items-center gap-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer">
<span className="material-symbols-outlined" data-icon="send">send</span>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Sent</span>
</div>
<div className="text-zinc-600 dark:text-zinc-400 py-2 px-3 flex items-center gap-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer">
<span className="material-symbols-outlined" data-icon="draft">draft</span>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Drafts</span>
</div>
<div className="text-zinc-600 dark:text-zinc-400 py-2 px-3 flex items-center gap-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer">
<span className="material-symbols-outlined" data-icon="archive">archive</span>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Archive</span>
</div>
<div className="text-zinc-600 dark:text-zinc-400 py-2 px-3 flex items-center gap-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer">
<span className="material-symbols-outlined" data-icon="delete">delete</span>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Trash</span>
</div>
</nav>
<div className="mt-8">
<span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-3 mb-2 block">Accounts</span>
<div className="text-zinc-600 dark:text-zinc-400 py-2 px-3 flex items-center gap-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer">
<img alt="Gmail" className="w-5 h-5 rounded" data-alt="Gmail minimalist logo icon on square background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA74A3QzZrDVcxSBLkQF_R1jRvETqSysUNTXkrh74QzwTxHx-WI9SAIyEbLnHmslmqOWbbbCSsCnKJP-QIkfzrJogZY4SjozeujS5w5qHeudIeob29ymCiTiWleaFhjazJOR25XFxbljLCPACAYtslNb1LufbuODNI-6cMhlj9PIOZ5DS2M8eRpvMv5Hr_9ncS1tEc-qHWc3fZd9a9nbWoiCyWvZQjWrL6iXRaEyojqdD_1Nawiete6L7yixee54k153nVb5BB5bd6r"/>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Google Mail</span>
</div>
<div className="text-zinc-600 dark:text-zinc-400 py-2 px-3 flex items-center gap-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer">
<img alt="Outlook" className="w-5 h-5 rounded" data-alt="Outlook minimalist logo icon on square background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA7nd-n9I3oZggNcQNIEMDqEgihZc5J0sB2atC-RiIfS3Sz6HPJvB0a3armTPDGU9LTGOxot8nO5PPUQ1BDGZjUNcNt-xryC6w-W9CLjhIcOBbw76ntQCgKmKBmnK_VUmbNfz99lUf-LhXRfHSWn7EqE-7p-8jIecxqbNhe82WvZ80UQDUkq9xU8Rbt2WA3S3SSFtXp3nIF-By941LKUaCCqeFf2VWidQEim4dpCqCWnloc4i5S3yxAldKWCEdSo98G-2muYjOJpFzN"/>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Outlook Business</span>
</div>
</div>
<div className="mt-auto pt-4 flex flex-col space-y-1">
<div className="text-zinc-600 dark:text-zinc-400 py-2 px-3 flex items-center gap-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer">
<span className="material-symbols-outlined" data-icon="settings">settings</span>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Settings</span>
</div>
<div className="text-zinc-600 dark:text-zinc-400 py-2 px-3 flex items-center gap-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer">
<span className="material-symbols-outlined" data-icon="help_outline">help_outline</span>
<span className="font-inter text-[13px] tracking-wide leading-relaxed">Support</span>
</div>
</div>
</aside>
{/* Main Content Area (Layout with Tonal Transitions) */}
<main className="ml-64 flex flex-1 overflow-hidden bg-surface">
{/* List Pane (Middle) */}
<section className="w-[380px] flex flex-col border-r-0 bg-surface-container-low/50 border-transparent">
{/* Top Bar (TopAppBar Component Mapping) */}
<header className="bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-xl w-full h-14 flex items-center sticky top-0 z-10 px-4 gap-4">
<div className="flex-1 bg-surface-container-highest/50 rounded-lg flex items-center px-3 py-1.5 gap-2 group transition-all focus-within:bg-white focus-within:shadow-sm">
<span className="material-symbols-outlined text-zinc-400 text-lg">search</span>
<input className="bg-transparent border-none focus:ring-0 text-sm p-0 w-full placeholder:text-zinc-400 text-zinc-900" placeholder="Search emails" type="text"/>
</div>
<div className="flex items-center gap-1">
<button className="p-1.5 text-zinc-500 hover:bg-zinc-200/50 rounded-md transition-all">
<span className="material-symbols-outlined text-[20px]">filter_list</span>
</button>
</div>
</header>
<div className="flex-1 overflow-y-auto no-scrollbar py-2">
{/* Email Item - Active */}
<div className="mx-3 mb-1 p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-primary/5 transition-all cursor-pointer ring-1 ring-primary/10">
<div className="flex items-start gap-3">
<div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold">
                                JD
                            </div>
<div className="flex-1 min-w-0">
<div className="flex justify-between items-center mb-0.5">
<span className="text-sm font-bold text-zinc-900 truncate">Julianne Dearden</span>
<span className="text-[11px] text-primary font-medium">9:41 AM</span>
</div>
<h4 className="text-[13px] font-semibold text-zinc-900 mb-1 truncate">Drafting the 2024 Product Roadmap</h4>
<p className="text-[12px] text-zinc-500 line-clamp-2 leading-relaxed">Hey team, I've started putting together the initial thoughts for our next major update...</p>
</div>
</div>
</div>
{/* Email Item */}
<div className="mx-3 mb-1 p-4 rounded-xl hover:bg-white/60 transition-all cursor-pointer group">
<div className="flex items-start gap-3">
<div className="w-10 h-10 rounded-full overflow-hidden">
<img alt="Marcus" data-alt="Professional corporate headshot of a smiling man with clean glasses and blurred office background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBqV5rYAPb_EulP4FUn0fj2oTFTUA2eHpFRpdrEiKXPQS3En2BCkY7DbxNHCvSZrMQ7_yjSKQhliDu0GPD7s85ON97XFxnhc3zu_1lHVQHdFPSmjEiRnXyBiEX3FP8Mu3-7ojsmmIQAPiUGPC3sPLMmfFny4fkiZiiwOi_rAkTkHknM_GkDklR86vBaJKmLp1JxPq8uG_c1SwpYsGCtRUD6Phdbj_edCJKdpHVziCs0gtb5_diJ6GpbT0T02o9Z3tQH9p4DY_Ww8WXj"/>
</div>
<div className="flex-1 min-w-0">
<div className="flex justify-between items-center mb-0.5">
<span className="text-sm font-medium text-zinc-600 truncate">Marcus Wright</span>
<span className="text-[11px] text-zinc-400">8:15 AM</span>
</div>
<h4 className="text-[13px] font-medium text-zinc-900 mb-1 truncate">Weekly Sync Notes</h4>
<p className="text-[12px] text-zinc-500 line-clamp-2 leading-relaxed">Attached are the notes from yesterday's sync meeting. Please review the action items...</p>
</div>
</div>
</div>
{/* Email Item */}
<div className="mx-3 mb-1 p-4 rounded-xl hover:bg-white/60 transition-all cursor-pointer group">
<div className="flex items-start gap-3">
<div className="w-10 h-10 rounded-full bg-zinc-200 flex items-center justify-center text-zinc-600 text-sm font-semibold">
                                SN
                            </div>
<div className="flex-1 min-w-0">
<div className="flex justify-between items-center mb-0.5">
<span className="text-sm font-medium text-zinc-600 truncate">Soma Networks</span>
<span className="text-[11px] text-zinc-400">Yesterday</span>
</div>
<h4 className="text-[13px] font-medium text-zinc-900 mb-1 truncate">Your subscription has been renewed</h4>
<p className="text-[12px] text-zinc-500 line-clamp-2 leading-relaxed">Thank you for staying with us. We've processed your annual renewal for the Pro plan...</p>
</div>
</div>
</div>
{/* Email Item */}
<div className="mx-3 mb-1 p-4 rounded-xl hover:bg-white/60 transition-all cursor-pointer group">
<div className="flex items-start gap-3">
<div className="w-10 h-10 rounded-full overflow-hidden">
<img alt="Helena" data-alt="Portrait of a young creative professional with artistic lighting and soft neutral background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDJ-yuTyMHui97HV-X_aLBcq140vXwFV7fCBwqdJvLpyqdTi-ukqS_oWaWRzph5WRnhQiU0KFLEWbc9TM0UcsUhcq6TNDnuNoRbN30WxvEA9ZsoNfJM2liTorZxL6XTg91xuYCAXR_F1Je1s8L-yZuVgerp7CIV49EU-vAKU2lZtCBEjJ8fT5ASg6tzgWEmju-uapV-dgow-GxfHkl6KAAiMQmZM97ZF_tEmX-ZSiQ5bUWNttU5bzp7TdFxMkgAmAmHlKRZtyFnZiMn"/>
</div>
<div className="flex-1 min-w-0">
<div className="flex justify-between items-center mb-0.5">
<span className="text-sm font-medium text-zinc-600 truncate">Helena Rossetti</span>
<span className="text-[11px] text-zinc-400">Yesterday</span>
</div>
<h4 className="text-[13px] font-medium text-zinc-900 mb-1 truncate">Design System Updates v2.4</h4>
<p className="text-[12px] text-zinc-500 line-clamp-2 leading-relaxed">The new color tokens are now live in the Figma library. I've also added the MICA effects...</p>
</div>
</div>
</div>
{/* Email Item */}
<div className="mx-3 mb-1 p-4 rounded-xl hover:bg-white/60 transition-all cursor-pointer group">
<div className="flex items-start gap-3">
<div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-sm font-semibold">
                                FL
                            </div>
<div className="flex-1 min-w-0">
<div className="flex justify-between items-center mb-0.5">
<span className="text-sm font-medium text-zinc-600 truncate">Flight Bookings</span>
<span className="text-[11px] text-zinc-400">Aug 12</span>
</div>
<h4 className="text-[13px] font-medium text-zinc-900 mb-1 truncate">Your itinerary for San Francisco</h4>
<p className="text-[12px] text-zinc-500 line-clamp-2 leading-relaxed">Pack your bags! Your flight SFO-245 is confirmed. View your boarding pass and terminal info...</p>
</div>
</div>
</div>
</div>
</section>
{/* Reading Pane (Right) */}
<section className="flex-1 flex flex-col bg-surface-container-lowest shadow-[inset_1px_0_0_0_rgba(0,0,0,0.03)]">
{/* Toolbar */}
<header className="h-14 flex items-center px-8 justify-between">
<div className="flex items-center gap-6">
<button className="flex items-center gap-2 text-zinc-500 hover:text-primary transition-colors text-sm font-medium">
<span className="material-symbols-outlined text-[20px]">reply</span>
                            Reply
                        </button>
<button className="flex items-center gap-2 text-zinc-500 hover:text-primary transition-colors text-sm font-medium">
<span className="material-symbols-outlined text-[20px]">reply_all</span>
                            Reply all
                        </button>
<button className="flex items-center gap-2 text-zinc-500 hover:text-primary transition-colors text-sm font-medium">
<span className="material-symbols-outlined text-[20px]">forward</span>
                            Forward
                        </button>
</div>
<div className="flex items-center gap-2">
<button className="p-2 text-zinc-400 hover:bg-zinc-100 rounded-lg transition-all">
<span className="material-symbols-outlined text-[20px]">archive</span>
</button>
<button className="p-2 text-zinc-400 hover:bg-zinc-100 rounded-lg transition-all">
<span className="material-symbols-outlined text-[20px]">delete</span>
</button>
<button className="p-2 text-zinc-400 hover:bg-zinc-100 rounded-lg transition-all">
<span className="material-symbols-outlined text-[20px]">more_horiz</span>
</button>
</div>
</header>
<div className="flex-1 overflow-y-auto px-8 py-10 max-w-4xl">
{/* Email Header */}
<div className="mb-10">
<h1 className="text-3xl font-bold text-zinc-900 mb-6 tracking-tight">Drafting the 2024 Product Roadmap</h1>
<div className="flex items-center gap-4">
<div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white text-lg font-semibold">
                                JD
                            </div>
<div>
<div className="flex items-center gap-2">
<span className="text-[15px] font-bold text-zinc-900">Julianne Dearden</span>
<span className="text-[13px] text-zinc-400">&lt;julianne@product-team.com&gt;</span>
</div>
<div className="text-[12px] text-zinc-500 mt-0.5">To: You, Marcus Wright, Helena Rossetti</div>
</div>
<div className="ml-auto text-[12px] text-zinc-400">
                                Aug 14, 2023, 9:41 AM
                            </div>
</div>
</div>
{/* Email Content */}
<div className="prose prose-zinc max-w-none">
<p className="text-zinc-800 leading-[1.8] text-[16px] mb-6">
                            Hi everyone,<br/><br/>
                            I've spent the last couple of days consolidating the feedback from our Q3 review and I'm ready to start drafting the roadmap for 2024.
                        </p>
<p className="text-zinc-800 leading-[1.8] text-[16px] mb-6">
                            The primary focus for the first half of the year will be **Infrastructure Stability** and **Core User Experience**. Based on the metrics we've seen, users are looking for a more "snappy" interface, especially in the search and filtering components.
                        </p>
<p className="text-zinc-800 leading-[1.8] text-[16px] mb-6">
                            I've broken down the major themes into three buckets:
                        </p>
<ul className="list-none space-y-4 mb-8 pl-0">
<li className="flex items-start gap-4 p-4 rounded-xl bg-surface-container-low/40">
<span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-0.5">1</span>
<div>
<strong className="text-zinc-900 block mb-1">Performance Optimization</strong>
<span className="text-sm text-zinc-600">Reducing load times by 40% across all primary views using the new caching layer.</span>
</div>
</li>
<li className="flex items-start gap-4 p-4 rounded-xl bg-surface-container-low/40">
<span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-0.5">2</span>
<div>
<strong className="text-zinc-900 block mb-1">Collaborative Workspaces</strong>
<span className="text-sm text-zinc-600">Enabling real-time shared folders and team-wide tagging systems.</span>
</div>
</li>
<li className="flex items-start gap-4 p-4 rounded-xl bg-surface-container-low/40">
<span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-0.5">3</span>
<div>
<strong className="text-zinc-900 block mb-1">Mobile Parity</strong>
<span className="text-sm text-zinc-600">Bringing the advanced filtering logic from the desktop app to iOS and Android.</span>
</div>
</li>
</ul>
<p className="text-zinc-800 leading-[1.8] text-[16px] mb-8">
                            Please let me know if there's anything urgent you think I've missed. I'd love to have a final draft ready for the board meeting next Tuesday.
                        </p>
<p className="text-zinc-800 leading-[1.8] text-[16px]">
                            Best regards,<br/>
<span className="font-bold text-zinc-900">Julianne Dearden</span><br/>
<span className="text-sm text-zinc-500">Director of Product | Essentialist Tech</span>
</p>
</div>
{/* Attachments */}
<div className="mt-12 pt-8 border-t border-zinc-100">
<h5 className="text-[13px] font-bold text-zinc-400 uppercase tracking-wider mb-4">Attachments (2)</h5>
<div className="flex gap-4">
<div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 transition-colors cursor-pointer group">
<div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-red-500">
<span className="material-symbols-outlined">picture_as_pdf</span>
</div>
<div className="pr-4">
<div className="text-[13px] font-semibold text-zinc-900">Roadmap_Draft_v1.pdf</div>
<div className="text-[11px] text-zinc-500">2.4 MB</div>
</div>
</div>
<div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 transition-colors cursor-pointer group">
<div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-blue-500">
<span className="material-symbols-outlined">table_chart</span>
</div>
<div className="pr-4">
<div className="text-[13px] font-semibold text-zinc-900">Resource_Alloc.xlsx</div>
<div className="text-[11px] text-zinc-500">840 KB</div>
</div>
</div>
</div>
</div>
{/* Quick Reply */}
<div className="mt-12 p-1 bg-surface-container-low rounded-2xl">
<div className="bg-white rounded-xl p-4 shadow-sm">
<textarea className="w-full border-none focus:ring-0 text-[15px] min-h-[100px] resize-none placeholder:text-zinc-400" placeholder="Write a quick reply..."></textarea>
<div className="flex justify-between items-center mt-2 pt-4 border-t border-zinc-50">
<div className="flex gap-2">
<button className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors">
<span className="material-symbols-outlined text-[20px]">attach_file</span>
</button>
<button className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors">
<span className="material-symbols-outlined text-[20px]">mood</span>
</button>
</div>
<button className="px-6 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:opacity-90 active:scale-[0.98] transition-all">
                                    Send
                                </button>
</div>
</div>
</div>
</div>
</section>
</main>
</div>

    </>
  );
}
