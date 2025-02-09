import { CommandContext, Composer, HearsContext, InlineQueryResultBuilder } from "grammy"
import { ConfigurationManager } from "../managers/config.ts"
import { BotActions, ConversionMethods, CustomContext, LinkConverter } from "../types/types.ts"
import { BotCommand } from "https://deno.land/x/grammy_types@v3.16.0/manage.ts"
import { findMatchingConverter, getExpeditorDebugString, getQueryDebugString } from "../utils.ts"
import { StatsManager } from "../managers/stats.ts"
import { AdminCommands } from "./admin.ts"
import { BotManager } from "../managers/bot.ts"

const CONFIG: ConfigurationManager = ConfigurationManager.Instance
const STATS: StatsManager = StatsManager.Instance
const BOT: BotManager = BotManager.Instance

export enum MainCommands
{
	START = "start",
	PING = "ping",
	HELP = "help",
	LINK_CONVERT = "convert",
	LINK_EMBED = "embed",
}

export const MainCommandsDetails: BotCommand[] = [
	{ command: MainCommands.START, description: "Start the bot." },
	{ command: MainCommands.HELP, description: "Get a list of supported links." },
	{ command: MainCommands.LINK_CONVERT, description: "Convert a link." },
]

export class MainActions implements BotActions
{
	readonly Composer: Composer<CustomContext> = new Composer<CustomContext>()

	constructor ()
	{
		this.addCommands()
		this.addInlineFeatures()
		this.addProactiveFeatures()
	}

	/**
	 * Process an incoming link conversion request.
	 * @param ctx Command or Hears context.
	 * @returns Completion promise.
	 */
	private async processConversionRequest (ctx: CommandContext<CustomContext> | HearsContext<CustomContext>, method: ConversionMethods): Promise<void>
	{
		// Handle mistakes where no link is given
		if (ctx.match.length < 1 && ctx.chat.type === "private")
		{
			await ctx.reply("Oop! No link was given with the command. 😅\nMaybe try again with a link following the command next time?\n<blockquote>Need help to use the command? Check « /help ».</blockquote>", {
				parse_mode: "HTML",
				reply_parameters: { message_id: ctx.msgId },
			})
			return
		}

		try
		{
			// Try casting it as a URL as a filter for bad requests.
			new URL(ctx.match.toString())
		} catch (error)
		{
			console.error(error)
			console.error(`Received link is invalid (${ ctx.match }), silently aborting processing it.`)
			return
		}

		// Check if link matches in map
		const url: URL = new URL(ctx.match.toString())
		const converter: LinkConverter | null = findMatchingConverter(url, CONFIG.AllConverters)
		if (converter)
		{
			await ctx.react("🤔")
			console.debug("Found the following match : " + converter?.name)
			const linkConverted: URL | null = await converter.parseLink(new URL(ctx.match.toString()))
			if (linkConverted)
			{
				await ctx.react("👀")
				await ctx.reply(linkConverted.toString(), { reply_parameters: { message_id: ctx.msgId }, link_preview_options: { show_above_text: true } })
				STATS.countConversion(converter, method)
			}
			else
				ctx.reply(
					`Oof… 'Looks like I can't convert that link right now. I apologize for that. 😓\n<blockquote>Either try again or report that as <a href="${ CONFIG.About.code_repo }/issues">an isssue on GitHub</a> and my creator will take a look at it. 💡</blockquote>`,
					{
						parse_mode: "HTML",
						reply_parameters: { message_id: ctx.msgId },
						link_preview_options: { is_disabled: true },
					},
				)
			return
		} else if (ctx.chat.type === "private")
		{
			// Handle when link isn't known in map
			await ctx.react("🗿")
			await ctx.reply(
				`Sorry, I don't have an equivalent for that website. 😥\n<blockquote>If you happen to know one, feel free to submit a request through <a href="${ CONFIG.About.code_repo }/issues">an Issue on my code's repository</a>. 💛</blockquote>`,
				{
					parse_mode: "HTML",
					reply_parameters: { message_id: ctx.msgId },
					link_preview_options: { is_disabled: true },
				},
			)
		}
	}

	private addCommands (): void
	{
		/**
		 * Start command
		 */
		this.Composer.chatType("private").command(MainCommands.START, function (ctx)
		{
			console.debug(`Incoming /${ MainCommands.START } by ${ getExpeditorDebugString(ctx) }`)
			ctx.react("👀")
			let response: string = `Hi! I'm the ${ BOT.Itself.botInfo.first_name }! 👋`
			response += "\nA simple bot that serves the purpose of automatically embedding links!"
			response += "\n"
			if (CONFIG.Features.link_recognition) response += "\nSend me a link I recognize and I'll respond with an embed-friendly + tracking-free version. ✨"
			if (CONFIG.BotInfo.can_join_groups) response += "\nAlso, if you add me to a group, I'll do the same with links I can convert. 👀"
			response += `\n<blockquote>If you need more help, use the /${ MainCommands.HELP } command.</blockquote>`
			response += "\n"
			response += `\nAnyway, I wish you a nice day! 🎶`
			ctx.reply(response, { reply_parameters: { message_id: ctx.msgId }, parse_mode: "HTML", link_preview_options: { is_disabled: true } })
			STATS.countCommand(MainCommands.START)
		})

		/**
		 * Healthcheck ping command
		 */
		this.Composer.chatType(["private", "group", "supergroup"]).command(MainCommands.PING, function (ctx)
		{
			console.debug(`Incoming /${ MainCommands.PING } by ${ getExpeditorDebugString(ctx) }`)
			ctx.react("⚡")
			ctx.reply("Pong! 🏓", { reply_parameters: { message_id: ctx.msgId } })
			STATS.countCommand(MainCommands.PING)
		})

		/**
		 * Get help instructions
		 */
		this.Composer.chatType("private").command(MainCommands.HELP, async function (ctx)
		{
			console.debug(`Incoming /${ MainCommands.HELP } by ${ getExpeditorDebugString(ctx) }`)
			let response: string = "Oh, you'll see. I'm a simple Synth!"
			response += "\n"
			response += `\nEither send me a link I recognize or use the /${ MainCommands.LINK_CONVERT } command to convert it into an embed-friendly one. ✨`
			response += `\nIf you're in another chat where I am not present, simply start by mentioning me (@${ CONFIG.BotInfo.username }) followed by a space and you'll be using my service in-line style! 😉`
			response += "\n"
			response += "\n<blockquote><b>Links I recognize at the moment</b>"
			for (const converter of CONFIG.AllConverters) if (converter.enabled) response += `\n${ converter.name } : ${ converter.origins.map((origin: URL): string => origin.hostname) } → ${ converter.destination.hostname }`
			response += "</blockquote>"
			response += "\n"
			response += "\nBy the way, if a preview doesn't generate, check with @WebpageBot. It's the one handling link preview generation within the app. 💡"
			response += "\n"
			if (ctx.config.isDeveloper)
			{
				response += "\nAlso, since you are an admin, you have extra commands you can use. 😉"
				response += "\n<blockquote><b>Admin commands</b>"
				for (const [, text] of Object.entries(AdminCommands)) response += `\n/${ text }`
				response += "</blockquote>"
				response += "\n"
			}
			response += `\nOf course, if there's a translation you'd like me to learn, feel free to suggest it as an issue <a href="${ CONFIG.About.code_repo }/issues/new">on GitHub</a>! 🌐`
			await ctx.reply(response, { reply_parameters: { message_id: ctx.msgId }, parse_mode: "HTML", link_preview_options: { is_disabled: true } })
			STATS.countCommand(MainCommands.HELP)
		})

		/**
		 * Convert link
		 */
		this.Composer.command([MainCommands.LINK_CONVERT, MainCommands.LINK_EMBED], async function (ctx)
		{
			console.debug(`Incoming /${ MainCommands.LINK_CONVERT } by ${ getExpeditorDebugString(ctx) } : ${ getQueryDebugString(ctx) }`)
			// TODO await processConversionRequest(ctx, ConversionMethods.COMMAND)
		})
	}

	private addProactiveFeatures ()
	{
		/**
		 * Detects and sends link replacements
		 */
		this.Composer.hears(CONFIG.ConversionOriginRegexes(), async function (ctx)
		{
			console.debug(`Recognized link by ${ getExpeditorDebugString(ctx) } : ${ getQueryDebugString(ctx) }`)
			// TODO await processConversionRequest(ctx, ConversionMethods.CONVO)
		})
	}

	private addInlineFeatures ()
	{
		this.Composer.inlineQuery(CONFIG.ConversionOriginRegexes(), async function (ctx)
		{
			console.debug(`Incoming inline conversion query by ${ getExpeditorDebugString(ctx) } : ${ getQueryDebugString(ctx) }`)
			const link: string = ctx.match.toString()

			try
			{
				// Try casting it as a URL as a filter for bad requests.
				new URL(ctx.match.toString())
			} catch (error)
			{
				console.error(error)
				console.error(`Received link is invalid (${ ctx.match }), silently aborting processing it.`)
				return
			}

			const url: URL = new URL(ctx.match.toString())
			const converter: LinkConverter | null = findMatchingConverter(url, CONFIG.AllConverters)
			if (converter)
			{
				const converted_link: URL | null = await converter.parseLink(new URL(link))
				if (converted_link)
				{
					const response: string = converted_link.toString()
					ctx.answerInlineQuery([InlineQueryResultBuilder.article(converter.name, `Convert ${ converter.name } link ✨`).text(response, { link_preview_options: { show_above_text: true } })])
					STATS.countConversion(converter, ConversionMethods.INLINE)
				}
			} else ctx.answerInlineQuery([])
		})
	}
}
