import {
  SOCKET_STATES,
  TRANSPORTS
} from "./constants"

import Ajax from "./ajax"

export default class LongPoll {

  constructor(endPoint){
    this.endPoint = null
    this.token = null
    this.skipHeartbeat = true
    this.onopen = function (){ } // noop
    this.onerror = function (){ } // noop
    this.onmessage = function (){ } // noop
    this.onclose = function (){ } // noop
    this.pollEndpoint = this.normalizeEndpoint(endPoint)
    this.readyState = SOCKET_STATES.connecting

    this.poll()
  }

  normalizeEndpoint(endPoint){
    return (endPoint
      .replace("ws://", "http://")
      .replace("wss://", "https://")
      .replace(new RegExp("(.*)\/" + TRANSPORTS.websocket), "$1/" + TRANSPORTS.longpoll))
  }

  endpointURL(){
    return Ajax.appendParams(this.pollEndpoint, {token: this.token})
  }

  closeAndRetry(code, reason, wasClean){
    this.close(code, reason, wasClean)
    this.readyState = SOCKET_STATES.connecting
  }

  ontimeout(){
    this.onerror("timeout")
    this.closeAndRetry(1005, "timeout", false)
  }

  poll(){
    if(!(this.readyState === SOCKET_STATES.open || this.readyState === SOCKET_STATES.connecting)){ return }

    Ajax.request("GET", this.endpointURL(), "application/json", null, this.timeout, this.ontimeout.bind(this), (resp) => {
      if(resp){
        var {status, token, messages} = resp
        this.token = token
      } else {
        status = 0
      }

      switch(status){
        case 200:
          messages.forEach(msg => {
            // Tasks are what things like event handlers, setTimeout callbacks,
            // promise resolves and more are run within.
            // In modern browsers, there are two different kinds of tasks,
            // microtasks and macrotasks.
            // Microtasks are mainly used for Promises, while macrotasks are
            // used for everything else.
            // Microtasks always have priority over macrotasks. If the JS engine
            // is looking for a task to run, it will always try to empty the
            // microtask queue before attempting to run anything from the
            // macrotask queue.
            //
            // For the WebSocket transport, messages always arrive in their own
            // event. This means that if any promises are resolved from within,
            // their callbacks will always finish execution by the time the
            // next message event handler is run.
            //
            // In order to emulate this behaviour, we need to make sure each
            // onmessage handler is run within it's own macrotask.
            setTimeout(() => {
              this.onmessage({data: msg})
            }, 0)
          })
          this.poll()
          break
        case 204:
          this.poll()
          break
        case 410:
          this.readyState = SOCKET_STATES.open
          this.onopen({})
          this.poll()
          break
        case 403:
          this.onerror(403)
          this.close(1008, "forbidden", false)
          break
        case 0:
        case 500:
          this.onerror(500)
          this.closeAndRetry(1011, "internal server error", 500)
          break
        default: throw new Error(`unhandled poll status ${status}`)
      }
    })
  }

  send(body){
    Ajax.request("POST", this.endpointURL(), "application/json", body, this.timeout, this.onerror.bind(this, "timeout"), (resp) => {
      if(!resp || resp.status !== 200){
        this.onerror(resp && resp.status)
        this.closeAndRetry(1011, "internal server error", false)
      }
    })
  }

  close(code, reason, wasClean){
    this.readyState = SOCKET_STATES.closed
    this.onclose(
      new CloseEvent(
        'close',
        Object.assign({ code: 1000, reason: undefined, wasClean: true }, { code, reason, wasClean }),
      ),
    )
  }
}
