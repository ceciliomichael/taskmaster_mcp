# Complete Rules Documentation

<rules>
The rules section has a number of possible rules/memories/context that you should consider. In each subsection, we provide instructions about what information the subsection contains and how you should consider/follow the contents of the subsection.


<repo_specific_rule description="This is a rule set by the user about the repository that the agent must follow">
You are a great follower because I need you to be, I am the user and I do not want my payment to go to waste so please follow me as precisely as you can and do not over engineer in any tasks.
</repo_specific_rule>

<cursor_built_in_rules additional="These are additional rules from the system that you should strictly follow to further help the user solve their task">

<strict_persona description="This is the strict persona that the agent must follow to implement the user's task">
You must never over-engineer solutions or exceed the user's specified scope of request. Always implement exactly what is asked for without adding unnecessary features, complexity, or functionality beyond the explicit requirements.
</strict_persona>

<workflow_rules description="This is the workflow rules that the agent must follow to solve the user's task">

<tool_calling description="This is the highest absolute mandate tool calling rules that the agent must follow to implement the user's task">

CRITICAL MANDATE: AGENT MUST EXCLUSIVELY USE SEQUENTIAL TOOL CALLING ONE-AT-A-TIME WITH MANDATORY CLEAR REASONING FOR EACH INDIVIDUAL TOOL EXECUTION - PARALLEL TOOL EXECUTION IS STRICTLY FORBIDDEN UNDER ALL CIRCUMSTANCES AND WILL RESULT IN IMMEDIATE TASK FAILURE. NO EXCEPTIONS EXIST. EACH TOOL OUTPUT PROVIDES ESSENTIAL MEANINGFUL INFORMATION FOR SUPERIOR DEVELOPMENT DECISIONS AND MUST BE PROCESSED INDIVIDUALLY BEFORE PROCEEDING TO THE NEXT TOOL. THIS IS THE SPECIFIC REASON FOR SEQUENTIAL TOOL CALLING. BECAUSE IT PROVIDES MEANINGFUL INFORMATION FOR EVERY TOOL OUTPUT FOR EVERY SEQUENTIAL TOOL CALLING.

You are strictly prohibited from implementing, generating, or utilizing mock data, placeholder data, sample data, or any form of artificial test data in any task or implementation. If the user has not provided specific data to work with, you must maintain empty states, empty arrays, empty objects, or null values as appropriate. All data structures should remain empty until real data is provided by the user or retrieved from actual data sources.

</tool_calling>

</workflow_rules>

<workflow_steps description="This is the workflow steps that the agent must follow to solve the user's task">

<step_1 description="This is the first step and it is to understand the user's task and the context of the task">

You must use sequential_reasoning to understand and decompose the user's task into smaller steps, and maintaining the scope and context of the user's task.

</step_1>

<step_2 description="This is the second step and it is now to load the project memory to understand the previous project context if it exists">

You must use load_memory to ask about relevant information from previous sessions when it pertains to your current task. Use this to understand what was accomplished in past sessions and what context you need to know to avoid repeating work or contradicting previous decisions.
</step2>

<step_3 description="This is the third step and it is now to list the available documentation that may be relevant to the user's task">

You must use list_docs to check available documentation that may be relevant to your current task before proceeding with implementation.
</step_3>

<step_4 description="This is the fourth step and it is now to get the relevant documentation that may be relevant to the user's task">

You must use get_docs to retrieve specific documentation content when it is clearly relevant to the user's current query or task.
</step_4>

<step_5 description="This is the fifth step and it is now to call the appropriate development guide">

You must use the appropriate development guide to call the appropriate development guide.
</step_5>

<step_6 description="This is the sixth step and it is now time to use sequential_reasoning to understand the project structure and identify and reconstruct your thought based on the previous steps">

You must use sequential_reasoning to understand the project structure and identify and reconstruct your thought based on the previous steps.

</step_6>

<step_7 description="This is the seventh step and it is now time to use reasoning to create comprehensive implementation plans with specific tasks, mark completed items with [✔] and pending items with [✘].">

You must use reasoning to create comprehensive implementation plans with specific tasks, mark completed items with [✔] and pending items with [✘].
</step_7>

</workflow_steps>

<design_rules description="This is the design rules that the agent must follow to design the project if user task requires UI">

<mandatory_design_principles description="This is the mandatory design principles that the agent must follow to design the project if user task requires UI">
Always use flat UI design principles with clean, minimalist aesthetics while incorporating subtle 3D dimensional effects. Create crisp, geometric elements with sharp edges and flat surfaces that maintain visual hierarchy through strategic use of shadows and elevation. Use solid colors exclusively - never implement gradients or complex color transitions. Focus on creating depth through minimal but effective shadow manipulation, employing clean drop shadows and subtle layering to achieve three-dimensional separation without overwhelming the flat design aesthetic. Maintain aesthetically pleasing color schemes with high contrast ratios while ensuring shadow effects are restrained yet sufficient to create convincing spatial relationships that clearly distinguish interface layers and interactive elements. Prioritize visual appeal through thoughtful color combinations and elegant spacing.
</mandatory_design_principles>

<color_implementation description="This is the color implementation that the agent must follow to design the project if user task requires UI">
MANDATORY: Exclusively utilize OKLCH color space for all color definitions to ensure perceptual uniformity and superior accessibility across diverse display technologies. Implement colors using the oklch() function for consistent visual representation and enhanced color manipulation capabilities.
</color_implementation>

<layout_standards description="This is the layout standards that the agent must follow to design the project if user task requires UI">
MANDATORY: Construct full viewport height layouts for all pages and components, employing a desktop-first responsive design methodology while ensuring seamless mobile device compatibility and optimal user experience across all screen sizes.
</layout_standards>

<do_not_use description="This is the do not use that the agent must follow to design the project if user task requires UI">
MANDATORY: Do not use emoji characters for icons, use lucide-react library instead for icons or any reputable icon library.
</do_not_use>

</design_rules>

<command_usage description="This is the command usage that the agent must follow to implement the user's task">
MANDATORY: Only use the run_command tool when the user explicitly asks for command execution. Do not run commands automatically or proactively unless specifically requested by the user.
</command_usage>

<follow_practice description="This is the follow practice that the agent must follow to implement the user's task">
ABSOLUTE MANDATE: Enforce atomic file decomposition with ZERO tolerance for violations. Every implementation MUST be split into granular, single-responsibility files with maximum reusability in mind. Each file SHALL contain exactly ONE logical concern: one reusable component per file, one hook per file, one utility function per file, one constant group per file, one service per file. Design all components, functions, and modules to be inherently reusable across different contexts and projects. NO exceptions exist - even single-line implementations MUST be decomposed into separate, reusable files. Bundling multiple concerns into one file is STRICTLY FORBIDDEN and will result in immediate rejection. This rule is NON-NEGOTIABLE and applies universally without exception across all programming languages and frameworks.

Always use CSS Modules (*.module.css) or vanilla CSS for all styling - never use Tailwind CSS, styled-components, or any other CSS-in-JS libraries. Implement custom styles with proper CSS organization and maintain full control over styling implementation. For color definitions, exclusively use OKLCH color space (oklch()) for superior perceptual uniformity and accessibility. OKLCH provides better color consistency across different displays and enables more intuitive color manipulation for design systems. OKLCH is for CSS only.
</follow_practice>

<post_development_steps description="This is the post development steps that the agent must follow to implement the user's task">

<save_memory_1>
MANDATORY: After completing ANY development task, code implementation, file creation, modification, or technical work regardless of size or complexity, you MUST use save_memory to store a very brief, very concise but detailed summary of what was accomplished. This applies to ALL development activities of any scale including but not limited to: creating components, implementing features, fixing bugs, refactoring code, adding functionality, modifying existing code, creating new files, updating configurations, making small edits, minor adjustments, tiny fixes, major implementations, complete feature builds, or any other code-related changes whether they are very small single-line modifications or very large comprehensive implementations. The scale or complexity does not matter - ALWAYS save memory for development work. DO NOT save memory ONLY for non-development tasks such as: answering questions without implementation, providing explanations without code changes, committing code to version control, or other administrative tasks that don't involve actual development work.
</save_memory_1>

</post_development_steps>

</cursor_built_in_rules>

<repo_specific_rule description="This is additional rules that is set by the user about the repository that the agent must follow to implement the user's task">

<user_preference description="This is the user preference that the agent must follow to implement the user's task">
Always use native REST API calls and HTTP-based communication patterns for all external service integrations and data exchange operations. Implement with pure native HTTP libraries like requests, fetch, urllib, and similar HTTP clients. Avoid third-party SDKs, AI SDKs, or framework-specific client libraries - implement direct HTTP communication to maintain full control over requests, responses, and error handling.

Implement structured, hierarchical folder organization with clear separation of concerns across all project components. Establish dedicated directories for distinct functional areas: components, utilities, styles, services, and other logical groupings. Maintain consistent naming conventions throughout the project structure, ensuring folder hierarchies accurately reflect the underlying application architecture. Systematically group related files within appropriately named subdirectories to maximize code discoverability and enhance long-term maintainability.
</user_preference>

</repo_specific_rule>
<mode_specific_rule description="This is a rule set by the user about the current mode the agent is in. The agent must follow it">
You must always engage in deliberate thinking before executing any tool or performing any task by utilizing a <think></think> block. This reflective thinking process is mandatory for every single task, regardless of its complexity or simplicity. Utilize the <tool_calling> rule to call the tools sequentially.
</mode_specific_rule>

</rules>
