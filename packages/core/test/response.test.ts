import { describe, expect, it } from 'bun:test'
import { ResponseBuilder } from '../src/index.js'

describe('ResponseBuilder', () => {
  it('should build a default 200 response', () => {
    const res = new ResponseBuilder().build()
    expect(res.status).toBe(200)
  })

  it('should set status', () => {
    const res = new ResponseBuilder().status(201).build()
    expect(res.status).toBe(201)
  })

  it('should set headers', () => {
    const res = new ResponseBuilder().header('X-Custom', 'hello').header('X-Another', 'world').build()
    expect(res.headers.get('X-Custom')).toBe('hello')
    expect(res.headers.get('X-Another')).toBe('world')
  })

  it('should build JSON response', async () => {
    const data = { name: 'Miia', version: 1 }
    const res = new ResponseBuilder().json(data).build()
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(await res.json()).toEqual(data)
  })

  it('should build text response', async () => {
    const res = new ResponseBuilder().text('Hello').build()
    expect(res.headers.get('Content-Type')).toBe('text/plain')
    expect(await res.text()).toBe('Hello')
  })

  it('should build HTML response', async () => {
    const res = new ResponseBuilder().html('<h1>Hi</h1>').build()
    expect(res.headers.get('Content-Type')).toBe('text/html')
    expect(await res.text()).toBe('<h1>Hi</h1>')
  })

  it('should build redirect response', () => {
    const res = new ResponseBuilder().redirect('/login').build()
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/login')
  })

  it('should build redirect with custom status', () => {
    const res = new ResponseBuilder().redirect('/new-url', 301).build()
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/new-url')
  })

  it('should build stream response', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'))
        controller.close()
      },
    })
    const res = new ResponseBuilder().stream(stream).build()
    expect(await res.text()).toBe('chunk')
  })

  it('should support fluent chaining', async () => {
    const res = new ResponseBuilder().status(201).header('X-Request-Id', 'abc').json({ created: true })

    const response = res.build()
    expect(response.status).toBe(201)
    expect(response.headers.get('X-Request-Id')).toBe('abc')
    expect(await response.json()).toEqual({ created: true })
  })

  it('should expose getStatus and getHeaders', () => {
    const builder = new ResponseBuilder().status(404).header('X-Foo', 'bar')
    expect(builder.getStatus()).toBe(404)
    expect(builder.getHeaders().get('X-Foo')).toBe('bar')
  })
})
