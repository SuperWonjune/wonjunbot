const { REST, Routes, SlashCommandBuilder, MessageFlags } = require("discord.js");
const config = require("../config/config");
const { voiceProfiles, setVoiceProfile } = require("../config/voiceProfiles");
const { parseYouTubeUrl } = require("../utils/youtubeUrl");

class CommandHandler {
    constructor(client, ttsService, musicService = null) {
        this.client = client;
        this.ttsService = ttsService;
        this.musicService = musicService;
        this.commands = [];

        this._defineCommands();
    }

    _defineCommands() {
        // /voice command
        const voiceChoices = voiceProfiles.map((p, index) => ({
            name: p.name,
            value: index.toString()
        }));

        const voiceCommand = new SlashCommandBuilder()
            .setName("voice")
            .setDescription("TTS 목소리를 변경합니다.")
            .addStringOption(option =>
                option.setName("profile")
                    .setDescription("변경할 목소리를 선택하세요")
                    .setRequired(true)
                    .addChoices(...voiceChoices));

        const ttsStartCommand = new SlashCommandBuilder()
            .setName("ttsstart")
            .setDescription("TTS 봇을 현재 음성 채널로 부릅니다.");

        const ttsStopCommand = new SlashCommandBuilder()
            .setName("ttsstop")
            .setDescription("TTS 봇을 음성 채널에서 내보냅니다.");

        this.commands = [voiceCommand.toJSON(), ttsStartCommand.toJSON(), ttsStopCommand.toJSON()];

        if (this.musicService) {
            const playCommand = new SlashCommandBuilder()
                .setName("play")
                .setDescription("YouTube 영상의 음악을 음성 채널에서 재생합니다.")
                .addStringOption(option =>
                    option.setName("url")
                        .setDescription("YouTube 영상 주소")
                        .setRequired(true));

            const skipCommand = new SlashCommandBuilder()
                .setName("스킵")
                .setDescription("지금 재생 중인 곡을 건너뜁니다.");

            const stopCommand = new SlashCommandBuilder()
                .setName("stop")
                .setDescription("음악을 멈추고 대기열을 비웁니다.");

            const queueCommand = new SlashCommandBuilder()
                .setName("대기열")
                .setDescription("재생 중인 곡과 대기열을 보여줍니다.");

            this.commands.push(playCommand.toJSON(), skipCommand.toJSON(), stopCommand.toJSON(), queueCommand.toJSON());
        }
    }

    /**
     * 음악 명령어 처리. 처리했으면 true
     */
    async _handleMusicCommand(interaction) {
        const music = this.musicService;
        const { commandName } = interaction;

        if (commandName === "play") {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                await interaction.reply({ content: "❌ 음성 채널에 먼저 접속해주세요.", flags: MessageFlags.Ephemeral });
                return true;
            }

            const parsed = parseYouTubeUrl(interaction.options.getString("url"));
            if (parsed.error) {
                await interaction.reply({ content: `❌ ${parsed.error}`, flags: MessageFlags.Ephemeral });
                return true;
            }

            // 영상 정보 조회에 몇 초 걸리므로 defer (모두에게 보이도록 공개 응답)
            await interaction.deferReply();
            try {
                const { track, position } = await music.enqueue(interaction.guild, voiceChannel, parsed.url, interaction.user);
                const content = position === 0
                    ? `🎵 재생: ${music.describe(track)}\n${track.url}`
                    : `➕ 대기열 ${position}번에 추가: ${music.describe(track)}`;
                await interaction.editReply({ content });
            } catch (error) {
                console.error("[Music] /play 실패:", error.message);
                await interaction.editReply({ content: `❌ 재생 실패: ${error.message}` });
            }
            return true;
        }

        if (commandName === "스킵") {
            const next = music.getState().queue[0];
            const skipped = music.skip();
            if (!skipped) {
                await interaction.reply({ content: "❌ 재생 중인 곡이 없습니다.", flags: MessageFlags.Ephemeral });
                return true;
            }
            await interaction.reply({
                content: `⏭️ 건너뜀: **${skipped.title}**` + (next ? `\n🎵 다음 곡: ${music.describe(next)}` : "\n대기열이 비었습니다."),
            });
            return true;
        }

        if (commandName === "stop") {
            const hadMusic = music.stop();
            if (!hadMusic) {
                await interaction.reply({ content: "❌ 재생 중인 음악이 없습니다.", flags: MessageFlags.Ephemeral });
                return true;
            }
            await interaction.reply({ content: "⏹️ 음악을 멈추고 대기열을 비웠습니다." });
            return true;
        }

        if (commandName === "대기열") {
            const { current, queue } = music.getState();
            if (!current && queue.length === 0) {
                await interaction.reply({ content: "대기열이 비어 있습니다. `/play` 로 곡을 추가해보세요.", flags: MessageFlags.Ephemeral });
                return true;
            }
            const lines = [];
            if (current) lines.push(`🎵 **지금 재생 중**: ${music.describe(current)}`);
            const shown = queue.slice(0, 10);
            shown.forEach((t, i) => lines.push(`${i + 1}. ${music.describe(t)}`));
            if (queue.length > shown.length) lines.push(`… 외 ${queue.length - shown.length}곡`);
            await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
            return true;
        }

        return false;
    }

    /**
     * Register commands to Discord
     */
    async registerCommands() {
        const rest = new REST({ version: "10" }).setToken(config.TOKEN);

        try {
            console.log("[Command] Slash Command 등록 시작...");

            // Register global commands
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: this.commands },
            );

            console.log("[Command] Slash Command 등록 완료!");
        } catch (error) {
            console.error("[Command] Command 등록 실패:", error);
        }
    }

    /**
     * Handle Interaction
     */
    async handleInteraction(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const { commandName } = interaction;

        try {
            if (this.musicService && await this._handleMusicCommand(interaction)) {
                return;
            }

            if (commandName === "voice") {
                const indexStr = interaction.options.getString("profile");
                const index = parseInt(indexStr, 10);

                try {
                    setVoiceProfile(interaction.user.id, index);
                    const profile = voiceProfiles[index];
                    await interaction.reply({
                        content: `✅ 목소리가 **${profile.name}**으로 변경되었습니다.`,
                        flags: MessageFlags.Ephemeral
                    });
                } catch (err) {
                    await interaction.reply({ content: `❌ 오류가 발생했습니다: ${err.message}`, flags: MessageFlags.Ephemeral });
                }
            } else if (commandName === "ttsstart") {
                const voiceChannel = interaction.member.voice.channel;
                if (!voiceChannel) {
                    await interaction.reply({ content: "❌ 음성 채널에 먼저 접속해주세요.", flags: MessageFlags.Ephemeral });
                    return;
                }

                // 음악 모드와 TTS 모드는 배타적이다 (TTS가 끼어들면 음악이 끊긴다)
                if (this.musicService?.isBusy()) {
                    await interaction.reply({
                        content: "❌ 지금은 음악 재생 중이라 TTS를 켤 수 없습니다. `/stop` 으로 음악을 끈 뒤 다시 시도해주세요.",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                try {
                    // 연결에 시간이 걸릴 수 있으므로 defer 처리
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                    await this.ttsService.start(interaction.guild, voiceChannel);
                    await interaction.editReply({ content: `✅ **${voiceChannel.name}** 채널에서 TTS를 시작합니다!` });
                } catch (error) {
                    // 이미 deferred 상태이므로 editReply 사용
                    if (interaction.deferred) {
                        await interaction.editReply({ content: `❌ 시작 실패: ${error.message}` });
                    } else {
                        await interaction.reply({ content: `❌ 시작 실패: ${error.message}`, flags: MessageFlags.Ephemeral });
                    }
                }

            } else if (commandName === "ttsstop") {
                // isActive가 false여도 연결이 남아있으면 정리할 수 있어야 한다
                // (연결 실패로 채널에 묶인 상태를 풀 수 있는 유일한 탈출구)
                if (!this.ttsService.hasSession()) {
                    await interaction.reply({ content: "❌ TTS가 현재 실행 중이 아닙니다.", flags: MessageFlags.Ephemeral });
                    return;
                }

                this.ttsService.stop();
                await interaction.reply({ content: "✅ TTS 서비스를 종료하고 퇴장합니다.", flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
    }
}

module.exports = CommandHandler;
