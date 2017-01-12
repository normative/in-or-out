'use strict'

const Promise = require('bluebird')
const Slack = require('slack-node')
const btoa = require('btoa')
const config = require('../config').validate()
const baseRequest = require('request')
const _ = require('lodash')

const harvestAPI = baseRequest.defaults({
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${config.harvest_admin_username}:${config.harvest_admin_password}`)}`,
    }
})

const handleSelectProject = 'harvest:handleSelectProject'

const handleSelectTask = 'harvest:handleSelectTask'

const handleHourInput = 'harvest:handleHourInput'

module.exports = (app) => {
    let slapp = app.slapp


    slapp.message('log', ['direct_message'], (msg, text) => {

        const slackUserId = msg.body.event.user
        const scope = {}

        getSlackUserEmail(slackUserId, msg.meta.bot_token)
            .then((emailAddress) => {
                console.log('Slack user email: ' + JSON.stringify(emailAddress, null, 2))
                scope.emailAddress = emailAddress
                return getHarvestUserIdWithEmail(emailAddress)
            })
            .then((harvestUserId) => {
                console.log('Harvest user ID: ' + JSON.stringify(harvestUserId, null, 2))
                scope.harvestUserId = harvestUserId
                if(!harvestUserId) {
                    return Promise.reject(`Uh oh, we couldn\'t find your email address ${scope.emailAddress} in Harvest.\nPlease make sure you have an account set up.`)
                }
                return getAllHarvestProjectsForUser(harvestUserId)
            })
            .then((projects) => {
                console.log('Harvest projects for this user: ' + JSON.stringify(projects, null, 2))

                scope.projects = projects

                const projectButtons = buttonsForProjects(projects)


                msg.say({
                    text: 'Log hours for which project?',
                    attachments: splitProjectbuttons(projectButtons)
                })
                    .route(handleSelectProject, {projects: scope.projects, harvestUserId: scope.harvestUserId})

            })
            .catch((err) => {
                if(typeof err === 'string') {
                    msg.say(err)
                }
                else {
                    console.log(err)
                    msg.say('Uh oh, something went wrong.')
                }
            })

    })

    slapp.route(handleSelectProject, (msg, state) => {

        const projects = state.projects

        if(msg.type !== 'action') {
            msg.say('You must select a project').route(handleSelectProject, state)
            return
        }

        if(msg.body.actions[0].value === 'cancel'){
            msg.say(returnRandomGoodByeString())
            return
        }

        const selectedProjectId = msg.body.actions[0].value

        console.log(`Selected projectID: ${selectedProjectId}`)


        const selectedProject = _.find(projects,(project) => {
            return project.id == selectedProjectId
        })

        const tasks = selectedProject.tasks

        if(tasks.length === 0) {
            msg.say('There are no tasks for this project. Please contact office admin.')
            return
        }



        const enrichedState = Object.assign({},
            state,
            { projects, selectedProject, selectedProjectId, tasks })

        msg.respond({
            text: `For project *\"${selectedProject.name}\"*, which task are you logging hours for?`,
            attachments: splitTaskButtons(tasks)
        })
            .route(handleSelectTask, enrichedState)
    })

    slapp.route(handleSelectTask, (msg, state) => {
        const selectedProject = state.selectedProject
        const tasks = state.tasks

        if(msg.type !== 'action') {
            msg.say('You must select a task').route(handleSelectTask, state)
            return
        }

        if(msg.body.actions[0].value === 'cancel'){
            msg.say(returnRandomGoodByeString())
            return
        }

        const selectedTaskId = msg.body.actions[0].value

        const selectedTask =  _.find(tasks,(task) => {
            return task.id == selectedTaskId
        })

        console.log(`Selected task ID: ${selectedTaskId}`)

        const enrichedState = Object.assign({},
            state,
            { selectedTaskId, selectedTask })
        msg.say(`For today, How many hours would you like to log for ${selectedTask.name} on *${selectedProject.name}*?`)
            .route(handleHourInput, enrichedState)
    })

    slapp.route(handleHourInput, (msg, state) => {
        const hours = parseFloat(msg.body.event.text)
        if (!hours) {
            msg.say('Please enter a valid numeric character. (i.e 6, 6.5)').route(handleHourInput, state)
            return
        }
        else if (hours <= 0) {
            msg.say('You must enter more than 0 hours').route(handleHourInput, state)
            return
        }
        else if (hours > 24) {
            msg.say('You can\'t enter more than 24 hours in a day').route(handleHourInput, state)
            return
        }


        logHoursToHarvest(state.harvestUserId, state.selectedProjectId, state.selectedTaskId, hours, new Date())
            .then((response) => {
                msg.say()

                const projectButtons = buttonsForProjects(state.projects)
                msg
                    .say({
                        text: `:thumbsup_all: You have successfully logged *${hours}* hours on *${state.selectedProject.name}* :pineappletime: \n` +
                        'Would you like to log more hours on another project?\nYou\'re currently assigned to these projects:',
                        attachments: splitProjectbuttons(projectButtons)

                        })
                    .route(handleSelectProject, state)

            })
            .catch((err) => {
                console.log('Error')
            })
    })
    slapp.message('.*', ['mention', 'direct_mention'], (msg) => {
        msg.say('Hello, how are you?')
    })
    slapp.message('hey', ['direct_message'], (msg, text) => {
        msg.say('Hello, how are you?')
    })

    slapp.message('help', ['direct_message'], (msg, text) => {
        msg.say('I can help you log hours on harvest, type `log` to start logging your hours.')
    })
    slapp.message('fuck', ['direct_message'], (msg, text) => {
        msg.say("Please keep profanity to a minimum!")
    })
    slapp.message('.*', ['direct_message'], (msg, text) => {
        msg.say("Hello, I'm Harvest Bot, I can help you easily log hours with Havest. Type `log` to at any time to start logging hours.")
    })

    return {}
}

function returnRandomGoodByeString() {
    if (Math.random() < 1.0) {
        return ([":wave:", "If you need me, I'll just be here dancing :pineappletime:", "See you later!"])
    }
}

function getSlackUserInfo(userId, authToken) {
    const slack = new Slack(authToken)

    return new Promise((resolve, reject) => {
        slack.api('users.info',
            { user: userId },
            (err, response) => {
                if(err) {
                    reject(err)
                    return
                }

                resolve(response.user)
            })
    })
}

function getSlackUserEmail(userId, authToken) {
    return getSlackUserInfo(userId, authToken)
        .then((userInfo) => {
            return userInfo.profile.email
        })
}

function getAllHarvestProjects() {
    return new Promise((resolve, reject) => {
        harvestAPI.get(config.harvest_api_base_url + '/projects?of_user=1488790', (err, response, body) => {
            if(err) {
                reject(err)
                return
            }
            resolve(JSON.parse(body))
        })
    })
}

function getAllHarvestProjectsForUser(userId) {
    return new Promise((resolve, reject) => {
        harvestAPI.get(`${config.harvest_api_base_url}/daily?of_user=${userId}`, (err, response, body) => {
            if(err) {
                reject(err)
                return
            }
            resolve(JSON.parse(body).projects)
        })
    })
}


function getAllHarvestUsers() {
    return new Promise((resolve, reject) => {
        harvestAPI.get(config.harvest_api_base_url + '/people', (err, response, body) => {
            if(err) {
                reject(err)
                return
            }
            resolve(JSON.parse(body))
        })
    })
}


function getHarvestUserIdWithEmail(emailAddress) {
    return getAllHarvestUsers()
        .then((allUsers) => {
            console.log(allUsers)
            const userWithMatchingEmail = _.find(allUsers,(element) => {
                return element.user.email === emailAddress

            })

            return userWithMatchingEmail && userWithMatchingEmail.user.id
        })
}


function logHoursToHarvest(userId, projectId, taskId, hours, date) {

    const now = new Date()

    return new Promise((resolve, reject) => {
        harvestAPI.post({
            uri: config.harvest_api_base_url + `/daily/add?of_user=${userId}`,
            json: {
                "notes": "",
                "hours": hours,
                "project_id": projectId,
                "task_id": taskId,
                "spent_at": `${now.getYear()}-${now.getMonth()}-${now.getDay()}`
            }
        }, (err, response, body) => {
            if(err) {
                reject(err)
                return
            }
            resolve(body)
        })
    })
}

function splitTaskButtons(tasks) {
    const splitButtons = [];
    let j = 0;
    let newButtonGroup = [];
    for (let i = 0; i < tasks.length; i++) {
        newButtonGroup.push(tasks[i])
        if ( (j===3) || (i === tasks.length-1)) {
            splitButtons.push(newButtonGroup);
            newButtonGroup = [];
            j = 0;
        }
        j++;
    }

    const attachments = [];
    for (let i = 0; i < splitButtons.length; i++) {
        const action = {};
        const cancelButton = {
            name: 'cancel',
            text: 'Cancel',
            type: 'button',
            value: 'cancel',
            style: 'danger',
        }
        let buttons = splitButtons[i];
        if (i === splitButtons.length - 1) {
            buttons.push(cancelButton);
        }
        action.text = '';
        action.callback_id = 'select_task';
        action.color = '#0f54e3'
        if (i === 0 ) {
            action.text = 'You\'re currently assigned to these projects:';
        }
        action.actions = buttons;
        console.log(action.actions)
        attachments.push(action);

    }
    return attachments
}

function splitProjectbuttons(projectButtons) {
    const splitButtons = [];
    let j = 0;
    let newButtonGroup = [];
    for (let i = 0; i < projectButtons.length; i++) {
        newButtonGroup.push(projectButtons[i])
        if ( (j===3) || (i === projectButtons.length-1)) {
            splitButtons.push(newButtonGroup);
            newButtonGroup = [];
            j = 0;
        }
        j++;
    }

    const attachments = [];
    for (let i = 0; i < splitButtons.length; i++) {
        const action = {};
        const cancelButton = {
            name: 'cancel',
            text: 'Cancel',
            type: 'button',
            value: 'cancel',
            style: 'danger',
        }
        let buttons = splitButtons[i];
        if (i === splitButtons.length - 1) {
            buttons.push(cancelButton);
        }
        action.text = '';
        action.callback_id = 'select_project';
        action.color = '#0f54e3'
        if (i === 0 ) {
            action.text = 'You\'re currently assigned to these projects:';
        }
        action.actions = buttons;
        console.log(action.actions)
        attachments.push(action);

    }
    return attachments
}


function buttonsForProjects(projects) {
    return projects.map((project) => {
        return {
            name: 'projectAnswer',
            text: project.name,
            type: 'button',
            value: project.id,
            style: 'default',
        }
    })
}