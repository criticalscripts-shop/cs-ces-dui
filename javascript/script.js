const hash = window.location.hash ? window.location.hash.replace('#', '') : null
const hashData = hash ? hash.split('|') : []
const resourceName = hashData[0]
const keyPlate = hashData[1]

if ((!resourceName) || (!keyPlate))
    window.location = 'https://criticalscripts.shop/'

const urlCheckElement = document.createElement('input')
const lerp = (a, b, t) => (a * (1 - t)) + (b * t)

const gainLerpIntervalMs = 16.66
const filterLerpIntervalMs = 16.66
const frequencyUpdateIntervalMs = 50
const screenshotUpdateIntervalMs = 500
const readyCheckIntervalMs = 500
const playingInfoUpdateIntervalMs = 500

let activeInstance = null

class Speaker {
    constructor(id, options, manager) {
        this.id = id
        this.options = options
        this.manager = manager

        this.volumeMultiplier = this.options.volumeMultiplier
        this.filterGainMultiplier = 1.0
        this.distanceMultiplier = 1.0
        this.applyLowPassFilter = true

        this.filter = this.manager.context.createBiquadFilter()
        this.panner = this.manager.context.createPanner()
        this.gain = this.manager.context.createGain()

        this.filter.type = 'highshelf'
        this.filter.frequency.value = 975
        this.filter.gain.value = -40.0

        this.gain.gain.value = 0.0

        this.filterLerp = {
            interval: null
        }

        this.gainLerp = {
            interval: null
        }

        this.panner.panningModel = 'HRTF'
        this.panner.distanceModel = 'exponential'
        this.panner.refDistance = this.options.refDistance
        this.panner.maxDistance = this.options.maxDistance
        this.panner.rolloffFactor = this.options.rolloffFactor
        this.panner.coneInnerAngle = this.options.coneInnerAngle
        this.panner.coneOuterAngle = this.options.coneOuterAngle
        this.panner.coneOuterGain = this.options.coneOuterGain

        this.manager.analyser.connect(this.panner)
        this.panner.connect(this.gain)
        this.gain.connect(this.manager.context.destination)

        this.lowPassFilterFade = 0.0
        this.filterConnected = false
        this.insideVehicle = false
    }

    update(data) {
        this.panner.positionX.setValueAtTime(Math.round(data.position[0]), this.manager.context.currentTime + this.manager.timeDelta)
        this.panner.positionY.setValueAtTime(Math.round(data.position[1]), this.manager.context.currentTime + this.manager.timeDelta)
        this.panner.positionZ.setValueAtTime(Math.round(data.position[2]), this.manager.context.currentTime + this.manager.timeDelta)

        this.panner.orientationX.setValueAtTime(Math.round(data.orientation[0]), this.manager.context.currentTime + this.manager.timeDelta)
        this.panner.orientationY.setValueAtTime(Math.round(data.orientation[1]), this.manager.context.currentTime + this.manager.timeDelta)
        this.panner.orientationZ.setValueAtTime(Math.round(data.orientation[2]), this.manager.context.currentTime + this.manager.timeDelta)

        if (data.lowPassFilterFade !== this.lowPassFilterFade || (this.applyLowPassFilter !== this.manager.applyLowPassFilter) || (this.filterConnected !== this.manager.applyLowPassFilter)) {
            this.applyLowPassFilter = this.manager.applyLowPassFilter
            this.lowPassFilterFade = data.lowPassFilterFade
            this.applyingLowPassFilter = this.lowPassFilterFade > 0

            if (!this.applyLowPassFilter)
                this.disconnectFilter()
            else
                this.connectFilter(this.lowPassFilterFade)
        }
        
        const linearMultiplier = 1.0 - ((data.distance - this.options.refDistance) / (this.options.maxDistance - this.options.refDistance))
        const exponentialMultiplier = Math.pow(Math.max(data.distance, this.options.refDistance) / this.options.refDistance, -this.options.rolloffFactor)

        if (linearMultiplier < exponentialMultiplier)
            this.panner.distanceModel = 'linear'
        else
            this.panner.distanceModel = 'exponential'

        this.gain.gain.value = 0.75 * (this.manager.volume * this.volumeMultiplier * this.filterGainMultiplier)

        if (this.manager.insideVehicle !== this.insideVehicle) {
            this.insideVehicle = this.manager.insideVehicle

            if (this.insideVehicle) {
                this.manager.analyser.disconnect(this.panner)
                this.panner.disconnect(this.gain)
                this.manager.analyser.connect(this.gain)
            } else {
                this.manager.analyser.disconnect(this.gain)
                this.manager.analyser.connect(this.panner)
                this.panner.connect(this.gain)
            }
        }
    }

    connectFilter(fade) {
        clearInterval(this.filterLerp.interval)
        clearInterval(this.gainLerp.interval)
        
        this.filterLerp.startValue = this.filter.gain.value
        this.filterLerp.startTime = Date.now()
        this.filterLerp.targetValue = fade * -40.0

        this.gainLerp.startValue = this.filterGainMultiplier
        this.gainLerp.startTime = Date.now()
        this.gainLerp.targetValue = this.applyingLowPassFilter ? ((100 - this.options.lowPassGainReductionPercent) / 100) : 1.0
        
        this.filterLerp.interval = setInterval(() => {
            const timeSinceStarted = Date.now() - this.filterLerp.startTime
            const percentageComplete = timeSinceStarted / this.options.fadeDurationMs

            this.filter.gain.value = percentageComplete >= 1.0 ? this.filterLerp.targetValue : lerp(this.filterLerp.startValue, this.filterLerp.targetValue, percentageComplete)

            if (percentageComplete >= 1.0)
                clearInterval(this.filterLerp.interval)
        }, filterLerpIntervalMs)
        
        this.gainLerp.interval = setInterval(() => {
            const timeSinceStarted = Date.now() - this.gainLerp.startTime
            const percentageComplete = timeSinceStarted / this.options.fadeDurationMs

            this.filterGainMultiplier = percentageComplete >= 1.0 ? this.gainLerp.targetValue : lerp(this.gainLerp.startValue, this.gainLerp.targetValue, percentageComplete)

            if (percentageComplete >= 1.0)
                clearInterval(this.gainLerp.interval)
        }, gainLerpIntervalMs)

        if (this.filterConnected)
            return

        this.gain.disconnect(this.manager.context.destination)
        this.gain.connect(this.filter)
        this.filter.connect(this.manager.context.destination)

        this.filterConnected = true
    }

    disconnectFilter() {
        if (!this.filterConnected)
            return

        clearInterval(this.filterLerp.interval)
        clearInterval(this.gainLerp.interval)

        this.filter.disconnect(this.manager.context.destination)
        this.gain.disconnect(this.filter)
        this.gain.connect(this.manager.context.destination)
        this.filter.gain.value = -40.0

        this.filterConnected = false
        this.filterGainMultiplier = 1.0
    }
}

class MediaManager {
    constructor(plate) {
        this.plate = plate
        this.pendingColorFetch = false
        this.playing = false

        this.syncedData = {
            playing: false,
            stopped: true,
            videoToggle: true,
            time: 0,
            volume: 0.0,
            url: null,
            temp: null
        }

        this.speakers = {}

        this.volume = 0.0
        this.applyLowPassFilter = true

        this.context = new window.AudioContext()
        this.listener = this.context.listener
        this.analyser = this.context.createAnalyser()

        this.timeDelta = 0.05

        this.analyser.fftSize = 4096
        this.analyser.smoothingTimeConstant = 0.8

        this.controllers = {
            dummy: new DummyController(this, true),
            youtube: new YouTubeController(this),
            twitch: new TwitchController(this),
            frame: new FrameController(this)
        }

        this.controller = this.controllers.dummy

        setInterval(() => {
            if (this.controller.playing)
                fetch(`https://${resourceName}/frequencyData`, {
                    method: 'POST',
                    body: JSON.stringify({
                        levels: this.getAverageFrequencyValues(),
                        plate: this.plate
                    })
                }).catch(error => {})
        }, frequencyUpdateIntervalMs)

        setInterval(() => {
            if (this.pendingColorFetch || (!this.controller.playing))
                return

            this.pendingColorFetch = true

            let screenshot = this.controller.screenshot()

            if (screenshot)
                Vibrant.from(screenshot).getPalette((error, palette) => {
                    if ((!error) && palette.Vibrant && palette.DarkVibrant && palette.LightVibrant && palette.Muted && palette.DarkMuted && palette.LightMuted)
                        fetch(`https://${resourceName}/colorData`, {
                            method: 'POST',
                            body: JSON.stringify({
                                plate: this.plate,
                                colors: {
                                    Vibrant: palette.Vibrant.rgb,
                                    DarkVibrant: palette.DarkVibrant.rgb,
                                    LightVibrant: palette.LightVibrant.rgb,
                                    Muted: palette.Muted.rgb,
                                    DarkMuted: palette.DarkMuted.rgb,
                                    LightMuted: palette.LightMuted.rgb
                                }
                            })
                        }).catch(error => {})

                    this.pendingColorFetch = false
                })
            else
                this.pendingColorFetch = false
        }, screenshotUpdateIntervalMs)

        setInterval(() => this.controllerPlayingInfo(this.controller), playingInfoUpdateIntervalMs)

        const readyCheck = setInterval(() => {
            if (Object.values(this.controllers).every(v => v.ready)) {
                fetch(`https://${resourceName}/managerReady`, {
                    method: 'POST',
                    body: JSON.stringify({
                        plate: this.plate
                    })
                }).catch(error => {})

                clearInterval(readyCheck)
            }
        }, readyCheckIntervalMs)

        document.title = ' '
    }

    showSpinner() {
        document.getElementById('spinner').style = 'display: block'
    }

    hideSpinner() {
        document.getElementById('spinner').style = 'display: none'
    }

    controllerPlayingInfo(controller) {
        if (controller.key === this.controller.key)
            fetch(`https://${resourceName}/controllerPlayingInfo`, {
                method: 'POST',
                body: JSON.stringify({
                    plate: this.plate,
                    time: controller.time(),
                    duration: controller.duration,
                    playing: controller.playing
                })
            }).catch(error => {})
    }

    controllerHooked(controller) {
        if (controller.media)
            controller.media.connect(this.analyser)
    }

    controllerInfo(controller) {
        if (controller.key === this.controller.key)
            fetch(`https://${resourceName}/controllerInfo`, {
                method: 'POST',
                body: JSON.stringify({
                    plate: this.plate,
                    controller: controller.key,
                    dynamic: controller.dynamic()
                })
            }).catch(error => {})

        this.controllerPlayingInfo(controller)
    }

    controllerSeeked(controller) {
        if (controller.key === this.controller.key)
            fetch(`https://${resourceName}/controllerSeeked`, {
                method: 'POST',
                body: JSON.stringify({
                    plate: this.plate,
                    controller: controller.key
                })
            }).catch(error => {})
    }

    controllerError(controller, error) {
        if (controller.key === this.controller.key) {
            this.hideSpinner()

            fetch(`https://${resourceName}/controllerError`, {
                method: 'POST',
                body: JSON.stringify({
                    plate: this.plate,
                    controller: controller.key,
                    error
                })
            }).catch(error => {})
        }
    }

    controllerEnded(controller) {
        if (controller.key === this.controller.key) {
            this.hideSpinner()

            fetch(`https://${resourceName}/controllerEnded`, {
                method: 'POST',
                body: JSON.stringify({
                    plate: this.plate,
                    controller: controller.key
                })
            }).catch(error => {})
        }
    }

    controllerResync(controller) {
        if (controller.key === this.controller.key)
            fetch(`https://${resourceName}/controllerResync`, {
                method: 'POST',
                body: JSON.stringify({
                    plate: this.plate,
                    controller: controller.key
                })
            }).catch(error => {})
    }

    update(data) {
        for (let index = 0; index < data.speakers.length; index++)
            if (this.speakers[data.speakers[index].id])
                this.speakers[data.speakers[index].id].update(data.speakers[index])

        this.listener.upX.setValueAtTime(Math.round(data.listener.up[0]), this.context.currentTime + this.timeDelta)
        this.listener.upY.setValueAtTime(Math.round(data.listener.up[1]), this.context.currentTime + this.timeDelta)
        this.listener.upZ.setValueAtTime(Math.round(data.listener.up[2]), this.context.currentTime + this.timeDelta)

        this.listener.forwardX.setValueAtTime(Math.round(data.listener.forward[0]), this.context.currentTime + this.timeDelta)
        this.listener.forwardY.setValueAtTime(Math.round(data.listener.forward[1]), this.context.currentTime + this.timeDelta)
        this.listener.forwardZ.setValueAtTime(Math.round(data.listener.forward[2]), this.context.currentTime + this.timeDelta)

        this.listener.positionX.setValueAtTime(Math.round(data.listener.position[0]), this.context.currentTime + this.timeDelta)
        this.listener.positionY.setValueAtTime(Math.round(data.listener.position[1]), this.context.currentTime + this.timeDelta)
        this.listener.positionZ.setValueAtTime(Math.round(data.listener.position[2]), this.context.currentTime + this.timeDelta)

        this.applyLowPassFilter = data.applyLowPassFilter
        this.insideVehicle = data.insideVehicle
    }

    addSpeaker(id, options) {
        this.speakers[id] = new Speaker(id, options, this)
    }

    getAverageFrequencyValues() {
        const types = {
            bass: {
                from: 20,
                to: 140
            },

            lowMid: {
                from: 140,
                to: 400
            },

            mid: {
                from: 400,
                to: 2600
            },

            highMid: {
                from: 2600,
                to: 5200
            },

            treble: {
                from: 5200,
                to: 14000
            }
        }

        const nyquistFrequency = this.context.sampleRate / 2
        const frequencyData = new Uint8Array(this.analyser.frequencyBinCount)

        this.analyser.getByteFrequencyData(frequencyData)

        const output = {}

        for (const key in types) {
            const lowIndex = Math.round((types[key].from / nyquistFrequency) * frequencyData.length)
            const highIndex = Math.round((types[key].to / nyquistFrequency) * frequencyData.length)

            output[key] = frequencyData.slice(lowIndex, highIndex).reduce((total, number) => total + number, 0) / (highIndex - lowIndex)
        }

        return output
    }

    sync(data) {
        this.plate = data.plate

        if (data.url !== this.syncedData.url || data.temp.force)
            this.set(data.url)

        if ((data.stopped !== this.syncedData.stopped || data.temp.force) && data.stopped)
            this.stop()
        else if (data.playing !== this.syncedData.playing || data.temp.force) {
            this.play(true)

            if (data.playing)
                this.play()
            else
                this.pause()
        }

        if (data.volume !== this.syncedData.volume || data.temp.force)
            this.setVolume(data.volume)

        if (data.temp.seek || data.temp.force)
            this.seek(data.temp.force && data.duration ? (data.time + 1 > data.duration ? data.time : (data.time + 1)) : data.time)

        if (data.videoToggle !== this.syncedData.videoToggle || data.temp.force)
            if (data.videoToggle || typeof(data.videoToggle) === 'undefined') // Backwards compatibility with 1.x.x versions.
                this.show()
            else
                this.hide()
    }

    adjust(time) {
        if (this.controller.playing && Math.abs(Math.round(this.controller.time()) - Math.round(time)) >= 3)
            this.seek(time)
    }

    play(muted = false) {
        this.syncedData.playing = true
        this.syncedData.stopped = false
        this.controller.play(muted)
    }

    pause() {
        this.syncedData.playing = false
        this.controller.pause()
    }

    stop() {
        this.syncedData.playing = false
        this.syncedData.stopped = true
        this.syncedData.time = 0
        this.controller.stop()
    }

    seek(time) {
        this.syncedData.time = time
        this.controller.seek(time)
    }

    setVolume(volume) {
        this.syncedData.volume = volume
        this.volume = volume
    }

    show() {
        this.syncedData.videoToggle = true
        this.controller.show()
    }
    
    hide() {
        this.syncedData.videoToggle = false
        this.controller.hide()
    }

    set(source) {
        this.syncedData.url = source

        if (!source) {
            this.controller.set(null)
            return
        }

        let data = {
            key: 'dummy',
            source
        }

        urlCheckElement.value = source

        if (urlCheckElement.validity.valid) {
            const ytVideoId = source.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i)
            const twitchChannel = source.match(/^(?:https?:\/\/)?(?:www\.|go\.)?twitch\.tv\/([A-z0-9_]+)($|\?)/i)
            const twitchVideo = source.match(/^(?:https?:\/\/)?(?:www\.|go\.)?twitch\.tv\/videos\/([0-9]+)($|\?)/i)
            const twitchClip = source.match(/(?:(?:^(?:https?:\/\/)?clips\.twitch\.tv\/([A-z0-9_-]+)(?:$|\?))|(?:^(?:https?:\/\/)?(?:www\.|go\.)?twitch\.tv\/(?:[A-z0-9_-]+)\/clip\/([A-z0-9_-]+)($|\?)))/)

            if (ytVideoId && ytVideoId[1])
                data = {
                    key: 'youtube',
                    source: ytVideoId[1]
                }
            else if (twitchChannel && twitchChannel[1])
                data = {
                    key: 'twitch',
                    source: `channel:${twitchChannel[1]}`
                }
            else if (twitchVideo && twitchVideo[1])
                data = {
                    key: 'twitch',
                    source: `video:${twitchVideo[1]}`
                }
            else if (twitchClip && (twitchClip[1] || twitchClip[2]))
                data = {
                    key: 'frame',
                    source: `${source}&parent=${location.hostname}`
                }
            else
                data = {
                    key: 'frame',
                    source
                }
        }

        if (this.controller.key === data.key)
            this.controller.set(data.source)
        else {
            this.controller.set(null)
            this.controller = this.controllers[data.key]
            this.controller.set(data.source)
        }

        this.controllerInfo(this.controller)
        this.controllerPlayingInfo(this.controller)
    }

    setIdleWallpaperUrl(url) {
        document.getElementById('idle').style = `background-image:url('${url}')`
    }
}

window.addEventListener('message', event => {
    switch (event.data.type) {
        case 'cs-ces:create':
            if (activeInstance)
                return

            activeInstance = new MediaManager(event.data.plate)

            break

        case 'cs-ces:update':
            if ((!activeInstance) || event.data.plate !== activeInstance.plate)
                return

            activeInstance.update({
                applyLowPassFilter: event.data.applyLowPassFilter,
                insideVehicle: event.data.insideVehicle,
                listener: event.data.listener,
                speakers: event.data.speakers
            })

            break

        case 'cs-ces:addSpeaker':
            if ((!activeInstance) || event.data.plate !== activeInstance.plate)
                return

            activeInstance.addSpeaker(event.data.speakerId, {
                refDistance: event.data.refDistance,
                maxDistance: event.data.maxDistance,
                rolloffFactor: event.data.rolloffFactor,
                coneInnerAngle: event.data.coneInnerAngle,
                coneOuterAngle: event.data.coneOuterAngle,
                coneOuterGain: event.data.coneOuterGain,
                fadeDurationMs: event.data.fadeDurationMs,
                volumeMultiplier: event.data.volumeMultiplier,
                lowPassGainReductionPercent: event.data.lowPassGainReductionPercent
            })

            break

        case 'cs-ces:setIdleWallpaperUrl':
            if ((!activeInstance) || event.data.plate !== activeInstance.plate)
                return

            activeInstance.setIdleWallpaperUrl(event.data.url)

            break

        case 'cs-ces:sync':
            if ((!activeInstance) || event.data.plate !== activeInstance.plate)
                return

            activeInstance.sync({
                plate: event.data.plate,
                playing: event.data.playing,
                stopped: event.data.stopped,
                time: event.data.time,
                volume: event.data.volume,
                url: event.data.url,
                temp: event.data.temp,
                videoToggle: event.data.videoToggle
            })

            break

        case 'cs-ces:adjust':
            if ((!activeInstance) || event.data.plate !== activeInstance.plate)
                return

            activeInstance.adjust(event.data.time)

            break
    }
})

urlCheckElement.setAttribute('type', 'url')

fetch(`https://${resourceName}/browserReady`, {
    method: 'POST',
    body: JSON.stringify({
        plate: keyPlate
    })
}).catch(error => {})