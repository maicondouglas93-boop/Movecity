import React, { useContext, useEffect, useState } from 'react'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { useNavigate } from 'react-router-dom'
import api from '@/services/axios'

const CaptainProtectWrapper = ({
    children
}) => {

    const token = localStorage.getItem('captain-token')
    const navigate = useNavigate()
    const { captain, setCaptain } = useContext(CaptainDataContext)
    const [ isLoading, setIsLoading ] = useState(true)




    useEffect(() => {
        if (!token) {
            navigate('/captain-login')
        }

        api.get('/captains/profile').then(response => {
            if (response.status === 200) {
                setCaptain(response.data.captain)
                setIsLoading(false)
            }
        })
            .catch(err => {

                localStorage.removeItem('captain-token')
                navigate('/captain-login')
            })
    }, [ token ])

    

    if (isLoading) {
        return (
            <div>Loading...</div>
        )
    }



    return (
        <>
            {children}
        </>
    )
}

export default CaptainProtectWrapper